import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from 'esbuild';
mkdirSync('.tmp-test',{recursive:true});
const js=transformSync(readFileSync('src/storage/migration.ts','utf8'),{loader:'ts',format:'esm'}).code.replace(/from ['"]@\/types['"];?/g,';');
writeFileSync('.tmp-test/migration.mjs',js);
const {isWorkspaceEmpty,isLegacyDemoWorkspace,shouldImportLocalWorkspace}=await import('../.tmp-test/migration.mjs');
const base={schemaVersion:1,savedAt:1,seed:null,notes:[],folders:[],tags:[],columns:[{id:'todo'}],cards:[],labels:[],settings:{}};
const checks=[
 ['null vide',isWorkspaceEmpty(null)],
 ['colonnes seules vides',isWorkspaceEmpty(base)],
 ['note rend non vide',!isWorkspaceEmpty({...base,notes:[{id:'n'}]})],
 ['carte rend non vide',!isWorkspaceEmpty({...base,cards:[{id:'c'}]})],
];
const demo={...base,
 notes:['note-docker','note-idees','note-sql'].map(id=>({id})),
 cards:['card-api','card-docker','card-model','card-perf','card-readme','card-scaffold','card-sql'].map(id=>({id})),
 folders:['fold-personnel','fold-projets','fold-recettes'].map(id=>({id})),
 tags:['tag-apprendre','tag-important','tag-travail'].map(id=>({id})),
 labels:[{id:'1'},{id:'2'},{id:'3'}],
};
checks.push(
 ['seed exact détecté',isLegacyDemoWorkspace(demo)],
 ['seed exact non importé',!shouldImportLocalWorkspace(null,demo)],
 ['seed enrichi non confondu',!isLegacyDemoWorkspace({...demo,notes:[...demo.notes,{id:'user-note'}]})],
 ['workspace utilisateur importé',shouldImportLocalWorkspace(null,{...base,notes:[{id:'user-note'}]})],
 ['serveur non vide jamais écrasé',!shouldImportLocalWorkspace({...base,notes:[{id:'remote'}]},{...base,notes:[{id:'local'}]})],
);
let fail=0;for(const [n,ok] of checks){console.log(`${ok?'OK  ':'FAIL'} ${n}`);if(!ok)fail++;}process.exit(fail?1:0);
