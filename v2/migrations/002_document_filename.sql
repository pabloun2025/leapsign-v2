-- PREPARATION ONLY: apply after 001 to a dedicated v2 database, NEVER v1.
begin;
alter table signing_v2.documents add column filename text not null default 'Documento.pdf'
  check (char_length(filename) between 5 and 128 and filename ~* '\.pdf$'
    and filename !~ E'[\r\n/\\\\]');
commit;
