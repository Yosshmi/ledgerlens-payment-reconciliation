import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parse} from 'dotenv';
import {resolve} from 'node:path';
const service=process.argv[2];
const env={...process.env,...parse(await readFile('.env'))};
env.MONGODB_URI=(await readFile('.runtime/mongodb-uri','utf8')).trim();
env.DATABASE_URL='sqlite:///'+resolve('.runtime/reconciliation.sqlite3').replaceAll('\\','/');
let command,args,cwd=process.cwd();
if(service==='django'){command=resolve('.venv/Scripts/python.exe');args=['manage.py',...process.argv.slice(3)];cwd=resolve('reconciliation-service');}
else if(service==='seed'){command=process.execPath;args=['--import','tsx','server/src/seed.ts'];}
else if(service==='api'){command=process.execPath;args=['--import','tsx','server/src/index.ts'];}
else if(service==='reconcile'){command=process.execPath;args=['--import','tsx','scripts/reconcile-local.ts'];}
else throw new Error('Use django, seed, api or reconcile');
const child=spawn(command,args,{cwd,env,stdio:'inherit'});child.on('exit',code=>process.exit(code??1));
