import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
await mkdir('.runtime/mongo',{recursive:true});
const replica=await MongoMemoryReplSet.create({instanceOpts:[{port:27017,dbPath:resolve('.runtime/mongo')}],replSet:{count:1,storageEngine:'wiredTiger'},binary:{version:'7.0.24'}});
await writeFile('.runtime/mongodb-uri',replica.getUri('ledgerlens'));
console.log('Local MongoDB replica set ready. URI stored in .runtime/mongodb-uri.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void replica.stop({doCleanup:false}).then(()=>process.exit(0)));
