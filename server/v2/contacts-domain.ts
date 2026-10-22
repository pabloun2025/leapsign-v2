export type ContactDraft={email:string;displayName?:string};
export type ContactValidation={ok:true;contacts:Array<{email:string;displayName:string|null}>}|{ok:false;code:'INVALID_CONTACT'|'DUPLICATE_CONTACT'|'CAPACITY_EXCEEDED'};

export function normalizeContactEmail(value:string){
 return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

export function validateContactDrafts(drafts:ContactDraft[],capacity:number):ContactValidation{
 if(!Number.isInteger(capacity)||capacity<0||capacity>20||!Array.isArray(drafts)||drafts.length>capacity)return{ok:false,code:'CAPACITY_EXCEEDED'};
 const contacts:Array<{email:string;displayName:string|null}>=[];const seen=new Set<string>();
 for(const draft of drafts){
  const email=normalizeContactEmail(draft.email);const displayName=(draft.displayName??'').normalize('NFC').trim();
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||displayName.length>120)return{ok:false,code:'INVALID_CONTACT'};
  const comparison=email.normalize('NFD').replace(/\p{M}/gu,'');
  if(seen.has(comparison))return{ok:false,code:'DUPLICATE_CONTACT'};seen.add(comparison);contacts.push({email,displayName:displayName||null});
 }
 return{ok:true,contacts};
}
