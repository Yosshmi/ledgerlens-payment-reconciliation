import {describe,it,expect} from 'vitest';
import {refundInput,verifyWebhook,signWebhook} from '../finance.js';
describe('Financial and webhook boundaries',()=>{
 it.each([0,-1,0.1,Number.MAX_SAFE_INTEGER,NaN])('rejects invalid amount %s',amountMinor=>{expect(refundInput.safeParse({transactionId:'TXN_ABC123',amountMinor,reason:'Customer requested'}).success).toBe(false);});
 it('accepts integer minor units',()=>{expect(refundInput.parse({transactionId:'TXN_ABC123',amountMinor:4999,reason:'Customer requested'}).amountMinor).toBe(4999);});
 it('rejects frontend actor injection',()=>{expect(refundInput.safeParse({transactionId:'TXN_ABC123',amountMinor:100,reason:'Customer requested',createdBy:'USR_ADMIN'}).success).toBe(false);});
 it('verifies exact raw bytes and freshness',()=>{const raw=Buffer.from('{"eventId":"EVT_1"}'),time=String(Math.floor(Date.now()/1000)),signature=signWebhook(raw,time);expect(()=>verifyWebhook(raw,time,signature)).not.toThrow();expect(()=>verifyWebhook(Buffer.from('{}'),time,signature)).toThrow('signature');expect(()=>verifyWebhook(raw,'1000000000',signature)).toThrow('timestamp');expect(()=>verifyWebhook(raw,time,'00')).toThrow('signature');});
});
