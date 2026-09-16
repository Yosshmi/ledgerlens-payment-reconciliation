import mongoose from 'mongoose';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {Audit,Event,Job,Payment,Refund,Webhook,Settlement} from './models.js';
import {AppError,fingerprint,id} from './utils.js';
import type {Actor} from './auth.js';
import {config} from './config.js';
export const amount=z.number().int().positive().max(1_000_000_000_000);
export const refundInput=z.object({transactionId:z.string().regex(/^TXN_[A-Z0-9_]+$/),amountMinor:amount,reason:z.string().trim().min(5).max(500)}).strict();
export async function requestRefund(actor:Actor,input:z.infer<typeof refundInput>,key:string){
 const hash=fingerprint(input);
 const existing=await Refund.findOne({organization:actor.organization,idempotencyKey:key});
 if(existing){if(existing.fingerprint!==hash)throw new AppError(409,'IDEMPOTENCY_CONFLICT','This key was used for a different request');return existing;}
 try{return await mongoose.connection.transaction(async session=>{
  const payment=await Payment.findOneAndUpdate({organization:actor.organization,transactionId:input.transactionId,status:{$in:['SUCCESS','PARTIALLY_REFUNDED']},$expr:{$gte:[{$subtract:['$amountMinor',{$add:['$refundedMinor','$reservedRefundMinor']}]},input.amountMinor]}},{$inc:{reservedRefundMinor:input.amountMinor}},{session,new:true});
  if(!payment)throw new AppError(409,'REFUND_NOT_ELIGIBLE','Payment is not eligible or the amount exceeds the refundable balance');
  const refundId=id('RFD');
  const [refund]=await Refund.create([{...input,refundId,organization:actor.organization,createdBy:actor.userId,idempotencyKey:key,fingerprint:hash}],{session});
  await Event.create([{eventId:id('EVT'),organization:actor.organization,transactionId:input.transactionId,eventType:'REFUND_CREATED',source:'api',metadata:{refundId,amountMinor:input.amountMinor}}],{session});
  await Audit.create([{auditId:id('AUD'),organization:actor.organization,actor:actor.userId,action:'REFUND_REQUESTED',entityType:'transaction',entityId:input.transactionId,metadata:{refundId,amountMinor:input.amountMinor}}],{session});
  await Job.create([{jobId:id('JOB'),organization:actor.organization,kind:'REFUND',payload:{refundId,outcome:'SUCCESS'},createdBy:actor.userId}],{session});return refund!;
 });}catch(error){
  // A competing transaction may have consumed the unique key or reserved the balance.
  const winner=await Refund.findOne({organization:actor.organization,idempotencyKey:key});
  if(winner){if(winner.fingerprint!==hash)throw new AppError(409,'IDEMPOTENCY_CONFLICT','This key was used for a different request');return winner;}
  throw error;
 }
}
export const webhookInput=z.object({eventId:z.string().min(8).max(100),organization:z.string().min(4).max(100),type:z.enum(['payment.success','payment.failed','refund.success','refund.failed','settlement.completed']),reference:z.string().min(5).max(100)}).strict();
export function signWebhook(raw:Buffer,timestamp:string){return createHmac('sha256',config.WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest('hex');}
export function verifyWebhook(raw:Buffer,timestamp:string,signature:string){
 if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300)throw new AppError(401,'WEBHOOK_EXPIRED','Webhook timestamp is invalid');
 const expected=Buffer.from(signWebhook(raw,timestamp),'hex');
 if(!/^[a-f0-9]{64}$/i.test(signature)||!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw new AppError(401,'WEBHOOK_SIGNATURE_INVALID','Invalid webhook signature');
}
export async function applyWebhook(input:z.infer<typeof webhookInput>){
 const hash=fingerprint(input);
 const previous=await Webhook.findOne({eventId:input.eventId}).lean();
 if(previous){if(previous.fingerprint!==hash)throw new AppError(409,'WEBHOOK_CONFLICT','Event ID reused with different content');return {duplicate:true};}
 try{return await mongoose.connection.transaction(async session=>{
  await Webhook.create([{...input,fingerprint:hash}],{session});
  let transactionId=input.reference;
  if(input.type.startsWith('payment.')){
   const payment=await Payment.findOne({organization:input.organization,transactionId:input.reference}).session(session);
   if(!payment)throw new AppError(404,'TRANSACTION_NOT_FOUND','Payment was not found');
   if(!['CREATED','PENDING','AUTHORIZED'].includes(payment.status))return {ignored:true};
   payment.status=input.type==='payment.success'?'SUCCESS':'FAILED';
   if(payment.status==='SUCCESS'){payment.ledgerDebitMinor=payment.amountMinor;payment.merchantCreditMinor=payment.amountMinor;}
   await payment.save({session});
   const eventTypes=payment.status==='SUCCESS'?['PAYMENT_AUTHORIZED','PAYMENT_SUCCESS','LEDGER_DEBIT_CREATED','MERCHANT_CREDIT_CREATED']:['PAYMENT_FAILED'];
   await Event.create(eventTypes.map(eventType=>({eventId:id('EVT'),organization:input.organization,transactionId,eventType,source:'gateway',correlationId:input.eventId})),{session});
  }else if(input.type.startsWith('refund.')){
   const refund=await Refund.findOne({organization:input.organization,refundId:input.reference}).session(session);
   if(!refund)throw new AppError(404,'REFUND_NOT_FOUND','Refund was not found');
   transactionId=refund.transactionId;if(['SUCCESS','FAILED'].includes(refund.status))return {ignored:true};
   const success=input.type==='refund.success';refund.status=success?'SUCCESS':'FAILED';await refund.save({session});
   const payment=await Payment.findOneAndUpdate({organization:input.organization,transactionId,reservedRefundMinor:{$gte:refund.amountMinor}},{$inc:{reservedRefundMinor:-refund.amountMinor,refundedMinor:success?refund.amountMinor:0,refundLedgerMinor:success?refund.amountMinor:0}},{new:true,session});
   if(!payment)throw new AppError(409,'REFUND_STATE_CONFLICT','Refund reservation is missing');
   if(success){payment.status=payment.refundedMinor===payment.amountMinor?'REFUNDED':'PARTIALLY_REFUNDED';await payment.save({session});}
   await Event.create([{eventId:id('EVT'),organization:input.organization,transactionId,eventType:success?'REFUND_SUCCESS':'REFUND_FAILED',source:'gateway',metadata:{refundId:refund.refundId},correlationId:input.eventId}],{session});
  }else{
   const settlement=await Settlement.findOne({organization:input.organization,settlementId:input.reference}).session(session);
   if(!settlement)throw new AppError(404,'SETTLEMENT_NOT_FOUND','Settlement was not found');
   if(settlement.status!=='COMPLETED')throw new AppError(409,'SETTLEMENT_NOT_READY','Settlement must finish processing before confirmation');
  }
  await Audit.create([{auditId:id('AUD'),organization:input.organization,actor:'SYSTEM_GATEWAY',action:input.type.toUpperCase().replace('.','_'),entityType:'transaction',entityId:transactionId,metadata:{eventId:input.eventId}}],{session});
  await Job.create([{jobId:id('JOB'),organization:input.organization,kind:'RECONCILE',payload:{transactionId:input.type==='settlement.completed'?undefined:transactionId}}],{session});
  return {duplicate:false};
 });}catch(error){const winner=await Webhook.findOne({eventId:input.eventId});if(winner?.fingerprint===hash)return {duplicate:true};throw error;}
}
