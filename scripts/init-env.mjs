import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
try{await readFile('.env');console.log('.env already exists; preserved');}catch{
 let content=await readFile('.env.example','utf8');
 for(const key of ['JWT_SECRET','WEBHOOK_SECRET','INTERNAL_SERVICE_SECRET','DJANGO_SECRET_KEY','DEMO_PASSWORD'])content=content.replace(`${key}=\n`,`${key}=${randomBytes(32).toString('hex')}\n`);
 await writeFile('.env',content,{flag:'wx'});console.log('Created .env with random local secrets.');
}
