import {execFileSync} from 'node:child_process';
import assets from '../assets-manifest.json';
let revision='unknown',dirty=true;
try {
 revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim();
}catch{/* Source archives may not contain Git metadata. */}
export const diagnosticBuild={revision,dirty,assets:assets.version,builtAt:new Date().toISOString()};
