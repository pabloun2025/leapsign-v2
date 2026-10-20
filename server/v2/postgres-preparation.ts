import {createHash} from 'node:crypto';
import type {SigningIntent} from '../../src/v2/contracts';
import type {PreparationDependencies} from './prepare-api';
import {MAX_PDF_BYTES, type SigningFlags} from '../../src/v2/policy';

export interface SqlConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters: unknown[]): Promise<{rows:T[]}>;
}
/** Must pin ONE connection and BEGIN/COMMIT/ROLLBACK, never pool.query BEGIN. */
export interface TransactionalSql extends SqlConnection {
  transaction<T>(action: (connection: SqlConnection) => Promise<T>): Promise<T>;
}
type Options = {
  database: TransactionalSql;
  flags: SigningFlags;
  authenticate: PreparationDependencies['authenticate'];
  reserve: PreparationDependencies['reserve'];
  /** Private object reader must enforce the supplied bound while streaming. */
  readPrivateObject(path: string, maxBytes: number): Promise<Uint8Array>;
};
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const uuid = (value: string) => {if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) throw Error('UNAVAILABLE'); return value;};
const one = <T>(rows: T[]) => {if (rows.length !== 1) throw Error('UNAVAILABLE'); return rows[0];};
const stageQuery = `select d.id as "documentId", v.id as "versionId", v.sha256 as "baseSha256",
 s.id as "stageId", s.signer_id as "signerId", s.role, v.page_count as "pageCount",
 v.last_page_width as "pageWidth", v.last_page_height as "pageHeight",
 s.expected_fingerprint as "expectedFingerprint", v.signature_count as "previousSignatureCount",
 d.filename from signing_v2.documents d
 join signing_v2.stages s on s.id=d.active_stage_id and s.document_id=d.id
 join signing_v2.versions v on v.id=d.current_version_id and v.document_id=d.id
 where d.id=$1 and s.signer_id=$2 and d.status='ready_for_signer' and s.status='ready_for_signer'`;

/** Concrete parameterized SQL operations. No credentials, remote connections or
 * schema grants are created here. Requires migrations 001 and 002 in v2 ONLY. */
export function postgresPreparation(options: Options): PreparationDependencies {
  const db = options.database;
  return {
    flags:options.flags, authenticate:options.authenticate, reserve:options.reserve,
    async loadStage(documentId, actor) {
      const row = one((await db.query(stageQuery,[uuid(documentId),uuid(actor)])).rows);
      // No nonce, password, storage path or unrelated metadata in public results.
      const {expectedFingerprint,...rest} = row;
      return {...rest,...(expectedFingerprint ? {expectedFingerprint} : {})} as Awaited<ReturnType<PreparationDependencies['loadStage']>>;
    },
    async loadCanonical(versionId, actor) {
      const row = one((await db.query(`select v.storage_path, v.byte_size, v.sha256
        from signing_v2.versions v join signing_v2.documents d on d.current_version_id=v.id and d.id=v.document_id
        join signing_v2.stages s on s.id=d.active_stage_id and s.document_id=d.id
        where v.id=$1 and s.signer_id=$2 and d.status='ready_for_signer' and s.status='ready_for_signer'`,[uuid(versionId),uuid(actor)])).rows);
      if (!Number.isInteger(row.byte_size) || Number(row.byte_size)<5 || Number(row.byte_size)>MAX_PDF_BYTES || typeof row.storage_path!=='string' || !/^[a-f0-9-]{36}\/versions\/[a-f0-9-]{36}\.pdf$/.test(row.storage_path)) throw Error('UNAVAILABLE');
      const bytes = await options.readPrivateObject(row.storage_path,Number(row.byte_size));
      if (bytes.length!==row.byte_size || hash(bytes)!==row.sha256) throw Error('UNAVAILABLE');
      return bytes;
    },
    async persistIntent(intent) {
      await db.transaction(async connection => {
        const row = one((await connection.query(`select * from signing_v2.issue_intent($1,$2,$3,$4,$5,$6)`,
          [uuid(intent.documentId),uuid(intent.signerId),uuid(intent.id),hash(intent.nonce),JSON.stringify(intent.position),uuid(intent.correlationId)])).rows);
        // RPC locks/rechecks the document. Reject stale preparation atomically:
        // throwing rolls back issuance and its audit event, not just this update.
        if (row.version_id!==intent.versionId || row.base_sha256!==intent.baseSha256 || row.stage_id!==intent.stageId || row.role!==intent.role || (row.expected_fingerprint ?? undefined)!==intent.expectedFingerprint) throw Error('CANONICAL_VERSION_CHANGED');
        const result = await connection.query(`update signing_v2.intents set issued_at=$2, expires_at=$3
          where id=$1 and $2::timestamptz between now()-interval '30 seconds' and now()+interval '30 seconds'
          and $3::timestamptz>now() returning id`,[intent.id,intent.issuedAt,intent.expiresAt]);
        one(result.rows);
      });
    },
    async loadIntent(id, actor) {
      const row = one((await db.query(`select id, document_id as "documentId", version_id as "versionId",
        base_sha256 as "baseSha256", stage_id as "stageId", signer_id as "signerId", role, profile, position,
        issued_at as "issuedAt", expires_at as "expiresAt", state, correlation_id as "correlationId",
        expected_fingerprint as "expectedFingerprint" from signing_v2.intents where id=$1 and signer_id=$2`,[uuid(id),uuid(actor)])).rows);
      const {expectedFingerprint,...rest}=row;
      // Download authorization needs the session, not the upload nonce. Its hash
      // cannot and must not be reversed. This sentinel is never returned by API.
      return {...rest,issuedAt:new Date(row.issuedAt as string).toISOString(),expiresAt:new Date(row.expiresAt as string).toISOString(),nonce:'withheld-download-only',...(expectedFingerprint?{expectedFingerprint}:{})} as SigningIntent;
    },
  };
}
