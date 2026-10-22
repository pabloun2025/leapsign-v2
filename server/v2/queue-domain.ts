export function parseQueueSession(cookieHeader:string|null){
 const values=(cookieHeader??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith('__Host-leapsign-v2-queue='));
 if(values.length!==1)return null;const token=values[0].slice('__Host-leapsign-v2-queue='.length);return/^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}

export function queuePresentation(value:{status:'waiting'|'active'|'completed'|'left';position:number;leaseExpiresAt:string|null}){
 return{state:value.status,peopleAhead:value.status==='waiting'?Math.max(0,value.position-1):0,leaseExpiresAt:value.leaseExpiresAt};
}
