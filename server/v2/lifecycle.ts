export const PROCESS_ACTIONS=['pause','resume','release_turn','rollback','cancel','complete','purge'] as const;
export type ProcessAction=typeof PROCESS_ACTIONS[number];
export type ValidProcessAction={action:ProcessAction;versionId:string|null;reason:string};

const uuid=(value:string)=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

export function validateProcessAction(value:unknown):ValidProcessAction|null{
 if(!object(value)||Object.keys(value).some(key=>!['action','versionId','reason'].includes(key))||typeof value.action!=='string'||!PROCESS_ACTIONS.includes(value.action as ProcessAction))return null;
 const reason=typeof value.reason==='string'?value.reason.normalize('NFC').trim():'';
 const versionId=value.versionId===null||value.versionId===undefined?null:value.versionId;
 if(reason.length>1000||(versionId!==null&&(typeof versionId!=='string'||!uuid(versionId)))||(value.action==='rollback')!==(versionId!==null))return null;
 return{action:value.action as ProcessAction,versionId,reason};
}
