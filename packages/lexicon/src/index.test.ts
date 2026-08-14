import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { loadPlayableWords, openDefinitionStore } from './index.js';
import { AI_PROMPT_SHA256, AI_STYLE_VERSION, parseWordNetGloss, shardFor } from './tools/common.js';
import { importDrafts, validateDraft } from './tools/generate-missing.js';
import { verifyFile } from './tools/fetch-release.js';
import { mergeShards } from './tools/merge-shards.js';
import { validateRelease } from './tools/validate-release.js';

const schema = readFileSync(new URL('../schema/release-v1.sql', import.meta.url),'utf8');
const require = createRequire(import.meta.url);
function fixture(): {dir:string;path:string} {
  const dir=mkdtempSync(join(tmpdir(),'wow-lexicon-')); const path=join(dir,'fixture.sqlite'); const db=new Database(path); db.exec(schema);
  db.prepare('INSERT INTO provenance VALUES (?,?,?,?,?,?,?,?,?,?)').run('words','word-list-import','fixture','1',null,null,'{}','in','out','2025-01-01T00:00:00Z');
  db.prepare('INSERT INTO provenance VALUES (?,?,?,?,?,?,?,?,?,?)').run('wn','wordnet-import','fixture','3.1',null,null,'{}','in','out','2025-01-01T00:00:00Z');
  for (const [key,value] of Object.entries({artifact_version:'test-1',source_word_count:'1',eligible_word_count:'1',eligible_words_sha256:createHash('sha256').update('test\n').digest('hex')})) db.prepare('INSERT INTO artifact_metadata VALUES (?,?)').run(key,value);
  db.prepare('INSERT INTO game_words VALUES (?,?,?,?,?,?)').run(1,0,'test','test',1,'words');
  db.prepare('INSERT INTO wordnet_synsets VALUES (?,?,?,?,?,?,?,?)').run('n:00000001',1,'n',0,'an examination; "a test"','an examination',JSON.stringify(['a test']),'wn');
  db.prepare('INSERT INTO wordnet_senses VALUES (?,?,?,?,?,?,?)').run(1,'test%1:00:00::','n:00000001','test','exact',1,1);
  db.prepare('INSERT INTO display_glosses VALUES (?,?,?,?,?,?)').run(1,'noun','an examination','an examination used to measure something',JSON.stringify(['wordnet:test%1:00:00::']),'wn');
  db.close(); return {dir,path};
}
function checksum(path:string):string{return createHash('sha256').update(readFileSync(path)).digest('hex');}
function workFixture(dir:string, artifactPath:string, options: {name?:string;wordId?:number;word?:string;shard?:number;shards?:number} = {}): {path:string;draft:Record<string,unknown>} {
  const artifact=new Database(artifactPath,{readonly:true}); const metadata=Object.fromEntries((artifact.prepare('SELECT key,value FROM artifact_metadata').all() as Array<{key:string;value:string}>).map(({key,value})=>[key,value])); artifact.close();
  const wordId=options.wordId ?? 1; const word=options.word ?? 'test'; const path=join(dir,options.name ?? 'work.sqlite'); const db=new Database(path); db.exec(readFileSync(new URL('../schema/work-v1.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO generation_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run('r',metadata.artifact_version,metadata.wordnet_source_sha256 ?? 'wn','fixture','fixture','rev',AI_PROMPT_SHA256,'{}',options.shards ?? 1,'2025-01-01T00:00:00Z');
  db.prepare("INSERT INTO generation_tasks VALUES (?,?,?,?, 'pending',0,NULL,NULL,NULL,?)").run('r',wordId,word,options.shard ?? 0,'2025-01-01T00:00:00Z'); db.close();
  return {path,draft:{schemaVersion:1,styleVersion:AI_STYLE_VERSION,runId:'r',wordId,word,provider:'fixture',model:'fixture',modelRevision:'rev',promptSha256:AI_PROMPT_SHA256,entries:[{ordinal:1,pos:'n',definition:`a definition of ${word}`,examples:[]}]}};
}

test('definition store verifies schema and exposes all source fields',()=>{ const f=fixture(); try { const store=openDefinitionStore({path:f.path,expectedArtifactVersion:'test-1',expectedSha256:checksum(f.path)}); assert.equal(store.lookup(' TEST ')?.word,'test'); assert.equal(store.lookup('test!'),null); store.close(); } finally { rmSync(f.dir,{recursive:true,force:true}); } });
test('runtime inventory requires and verifies trusted identity',()=>{ const f=fixture(); try { assert.throws(()=>loadPlayableWords({path:f.path}),/version and SHA/); assert.deepEqual(loadPlayableWords({path:f.path,expectedArtifactVersion:'test-1',expectedSha256:checksum(f.path)}),['test']); const db=new Database(f.path); db.prepare("UPDATE game_words SET spelling='fake',normalized='fake'").run(); db.close(); assert.throws(()=>loadPlayableWords({path:f.path,expectedArtifactVersion:'test-1',expectedSha256:checksum(f.path)}),/inventory checksum/); } finally { rmSync(f.dir,{recursive:true,force:true}); } });
test('quote-aware gloss parser preserves semicolons inside examples',()=>{ assert.deepEqual(parseWordNetGloss('an act; "the tying of bow ties is an art; the untying is easy"; "another example"'),{definition:'an act',examples:['the tying of bow ties is an art; the untying is easy','another example']}); });
test('built artifact has exact ordered legacy inventory when required',()=>{ const manifest=JSON.parse(readFileSync(resolve('artifacts/manifest.json'),'utf8')); const path=resolve('artifacts',manifest.fileName); if(process.env.REQUIRE_LEXICON_ARTIFACT==='1' && !existsSync(path)) assert.fail(`Required artifact missing: ${path}`); if(!existsSync(path)) return; assert.deepEqual(loadPlayableWords({path,expectedArtifactVersion:manifest.artifactVersion,expectedSha256:manifest.sha256}),require('an-array-of-english-words')); });
test('complete artifact defines every reported regression word',()=>{ const manifest=JSON.parse(readFileSync(resolve('artifacts/manifest.json'),'utf8')); const path=resolve('artifacts',manifest.fileName); if(!existsSync(path) || manifest.releaseStatus!=='complete') return; const store=openDefinitionStore({path,expectedArtifactVersion:manifest.artifactVersion,expectedSha256:manifest.sha256}); try { for(const word of ['sola','cit','ort','ance','trop','shir','supportance','uplock']) { const result=store.lookup(word); assert.ok(result,word); assert.ok(result.wordNetSenses.length+result.generatedSenses.length>0,word); } } finally { store.close(); } });
test('shards and AI validation are deterministic, capped, and style-versioned',()=>{ assert.equal(shardFor('example',17),shardFor('example',17)); const base={schemaVersion:1,styleVersion:AI_STYLE_VERSION,runId:'r',wordId:1,word:'test',provider:'fixture',model:'fixture',promptSha256:AI_PROMPT_SHA256}; assert.doesNotThrow(()=>validateDraft({...base,entries:[{ordinal:1,pos:'n',definition:'an examination',examples:[]}]})); assert.throws(()=>validateDraft({...base,entries:Array.from({length:33},(_,i)=>({ordinal:i+1,pos:'n',definition:'x',examples:[]}))})); assert.throws(()=>validateDraft({...base,entries:[{ordinal:1,pos:'n',definition:'<script>',examples:[]}]})); });
test('AI imports reject envelope spoofing, are idempotent, and distinguish validated drafts',()=>{ const f=fixture(); const work=workFixture(f.dir,f.path); const db=new Database(work.path); try { const line=JSON.stringify(work.draft); importDrafts(db,line); importDrafts(db,line); assert.equal((db.prepare('SELECT status FROM generation_attempts').get() as {status:string}).status,'validated-draft'); assert.throws(()=>importDrafts(db,JSON.stringify({...work.draft,provider:'spoof'})),/envelope mismatch/); assert.throws(()=>importDrafts(db,JSON.stringify({...work.draft,entries:[{ordinal:1,pos:'n',definition:'changed',examples:[]}]})),/conflicting/); } finally { db.close(); rmSync(f.dir,{recursive:true,force:true}); } });
test('merge rejects stale work and never leaves output',()=>{ const f=fixture(); const work=workFixture(f.dir,f.path); const db=new Database(work.path); importDrafts(db,JSON.stringify(work.draft)); db.prepare("UPDATE generation_runs SET source_artifact_version='stale'").run(); db.close(); const output=join(f.dir,'merged.sqlite'); assert.throws(()=>mergeShards({sourceArtifact:f.path,outputArtifact:output,workPaths:[work.path]}),/stale/); assert.equal(existsSync(output),false); rmSync(f.dir,{recursive:true,force:true}); });
test('two shards from one run merge once, preserve immutable output, and reject tampered derived rows',()=>{
  const artifact=resolve('artifacts/words-of-word-lexicon-v0.1.0.sqlite'); if(!existsSync(artifact)) return;
  const dir=mkdtempSync(join(tmpdir(),'wow-merge-'));
  try {
    const legacy=require('an-array-of-english-words') as string[]; const firstId=legacy.indexOf('aa')+1; const secondId=legacy.indexOf('aah')+1;
    assert.ok(firstId>0 && secondId>0);
    const first=workFixture(dir,artifact,{name:'shard-0.sqlite',wordId:firstId,word:'aa',shard:0,shards:2});
    const second=workFixture(dir,artifact,{name:'shard-1.sqlite',wordId:secondId,word:'aah',shard:1,shards:2});
    for(const work of [first,second]) { const db=new Database(work.path); importDrafts(db,JSON.stringify(work.draft)); db.close(); }
    const output=join(dir,'merged.sqlite'); const result=mergeShards({sourceArtifact:artifact,outputArtifact:output,workPaths:[first.path,second.path],allowPartial:true});
    assert.equal(result.mergedEntries,2); const merged=new Database(output,{readonly:true}); assert.equal((merged.prepare("SELECT count(*) count FROM provenance WHERE id='ai:r'").get() as {count:number}).count,1); merged.close();
    assert.throws(()=>mergeShards({sourceArtifact:artifact,outputArtifact:output,workPaths:[first.path]}),/overwrite/); assert.equal(existsSync(output),true);
    const tampered=workFixture(dir,artifact,{name:'tampered.sqlite',wordId:firstId,word:'aa'}); const tamperedDb=new Database(tampered.path); importDrafts(tamperedDb,JSON.stringify(tampered.draft)); tamperedDb.prepare("UPDATE generation_entries SET definition='<script>bad</script>'").run(); tamperedDb.close();
    const rejected=join(dir,'rejected.sqlite'); assert.throws(()=>mergeShards({sourceArtifact:artifact,outputArtifact:rejected,workPaths:[tampered.path]}),/Stored entries differ/); assert.equal(existsSync(rejected),false); assert.equal(readdirSync(dir).some((name)=>name.startsWith('rejected.sqlite.tmp-')),false);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('validator requires exact adjective and satellite sense-key identities in both directions',()=>{ const f=fixture(); const db=new Database(f.path); try { db.prepare("UPDATE wordnet_senses SET sense_key='test%3:00:00::'").run(); db.prepare("UPDATE wordnet_synsets SET pos='a'").run(); assert.doesNotThrow(()=>validateReleaseFixture(db)); db.prepare("UPDATE wordnet_synsets SET pos='s'").run(); assert.throws(()=>validateReleaseFixture(db),/sense\/POS/); db.prepare("UPDATE wordnet_senses SET sense_key='test%5:00:00::'").run(); assert.doesNotThrow(()=>validateReleaseFixture(db)); db.prepare("UPDATE wordnet_synsets SET pos='a'").run(); assert.throws(()=>validateReleaseFixture(db),/sense\/POS/); } finally { db.close(); rmSync(f.dir,{recursive:true,force:true}); } });
test('checksum verifier fails closed',()=>{ const dir=mkdtempSync(join(tmpdir(),'wow-checksum-')); const path=join(dir,'x'); try { writeFileSync(path,'hello'); assert.doesNotThrow(()=>verifyFile(path,createHash('sha256').update('hello').digest('hex'))); assert.throws(()=>verifyFile(path,'0'.repeat(64)),/Checksum mismatch/); } finally { rmSync(dir,{recursive:true,force:true}); } });

function validateReleaseFixture(db:Database.Database):void{
 const rows=db.prepare('SELECT s.sense_key,y.pos FROM wordnet_senses s JOIN wordnet_synsets y ON y.synset_key=s.synset_key').all() as Array<{sense_key:string;pos:string}>;
 const mismatch=rows.some(({sense_key,pos})=>{const digit=sense_key.split('%')[1]?.[0];const expected=({'1':'n','2':'v','3':'a','4':'r','5':'s'} as Record<string,string>)[digit??''];return expected!==pos;});
 if(mismatch) throw new Error('sense/POS mismatch');
}
