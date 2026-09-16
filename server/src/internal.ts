import {config} from './config.js';
import {AppError} from './utils.js';
export async function internal(path:string,organization:string,options:{method?:string;body?:unknown;actor?:string;role?:string}={}){
 const response=await fetch(`${config.DJANGO_URL}${path}`,{method:options.method??'GET',headers:{'Content-Type':'application/json','Authorization':`Bearer ${config.INTERNAL_SERVICE_SECRET}`,'X-Organization':organization,'X-Actor':options.actor??'SYSTEM_WORKER','X-Role':options.role??'SYSTEM'},body:options.body===undefined?undefined:JSON.stringify(options.body),signal:AbortSignal.timeout(30_000)});
 if(!response.ok){throw new AppError(response.status>=500?503:response.status,'RECONCILIATION_ERROR',response.status>=500?'Reconciliation service is temporarily unavailable':'Reconciliation request was rejected');}
 return response.json();
}
