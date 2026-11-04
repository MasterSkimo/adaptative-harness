import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cli=fileURLToPath(new URL("../apps/cli/src/main.ts",import.meta.url));
function invoke(home:string,...args:string[]){
  // No user settings or credential files are modified outside the fixture.
  const output=spawnSync(process.execPath,["--experimental-strip-types",cli,...args],{
    encoding:"utf8",timeout:10000,env:{...process.env,ADAPTIVE_HARNESS_HOME:home}
  });
  return {status:output.status,stdout:output.stdout,stderr:output.stderr};
}

test("OpenCode installer is preview-first, idempotent and preserves unrelated files",()=>{
  const dir=mkdtempSync(join(tmpdir(),"harness-cli-"));
  const project=join(dir,"project"),home=join(dir,"harness");
  mkdirSync(project);
  const unrelated=join(project,".opencode","plugins","other.ts");
  mkdirSync(dirname(unrelated),{recursive:true});
  writeFileSync(unrelated,"// User-owned plugin");
  const target=join(project,".opencode","plugins","adaptive-harness","index.ts");
  try{
    const registered=invoke(home,"project","register","--root",project);
    assert.equal(registered.status,0,registered.stderr);
    assert.ok(JSON.parse(registered.stdout).projectId);
    const preview=invoke(home,"install","--provider","opencode","--scope","project","--root",project);
    assert.equal(preview.status,0,preview.stderr);
    assert.equal(JSON.parse(preview.stdout).operation,"create");
    assert.equal(existsSync(target),false);
    const first=invoke(home,"install","--provider","opencode","--scope","project","--root",project,"--apply");
    assert.equal(first.status,0,first.stderr);
    assert.ok(existsSync(target));
    const original=readFileSync(target,"utf8");
    const repeat=invoke(home,"install","--provider","opencode","--scope","project","--root",project,"--apply");
    assert.equal(repeat.status,0,repeat.stderr);
    assert.equal(JSON.parse(repeat.stdout).operation,"none");
    assert.equal(readFileSync(target,"utf8"),original);
    assert.equal(invoke(home,"uninstall","--provider","opencode","--scope","project","--root",project).status,0);
    assert.ok(existsSync(target)); // Preview never removes the plugin.
    const remove=invoke(home,"uninstall","--provider","opencode","--scope","project","--root",project,"--apply");
    assert.equal(remove.status,0,remove.stderr);
    assert.equal(existsSync(target),false);
    assert.equal(readFileSync(unrelated,"utf8"),"// User-owned plugin");
    assert.equal(invoke(home,"uninstall","--provider","opencode","--scope","project","--root",project,"--apply").status,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("installer refuses to replace a user-modified managed file",()=>{
  const dir=mkdtempSync(join(tmpdir(),"harness-cli-"));
  const project=join(dir,"project"),home=join(dir,"harness");
  mkdirSync(project);
  try{
    assert.equal(invoke(home,"install","--provider","opencode","--scope","project","--root",project,"--apply").status,0);
    const path=join(project,".opencode","plugins","adaptive-harness","index.ts");
    writeFileSync(path,"// custom content");
    assert.notEqual(invoke(home,"install","--provider","opencode","--scope","project","--root",project,"--apply").status,0);
    assert.notEqual(invoke(home,"uninstall","--provider","opencode","--scope","project","--root",project,"--apply").status,0);
    assert.equal(readFileSync(path,"utf8"),"// custom content");
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("installer upgrades the exact previous OpenCode plugin without touching unknown edits",()=>{
  const dir=mkdtempSync(join(tmpdir(),"harness-cli-upgrade-"));
  const project=join(dir,"project"),home=join(dir,"harness");
  mkdirSync(project);
  try{
    const target=join(project,".opencode","plugins","adaptive-harness","index.ts");
    mkdirSync(dirname(target),{recursive:true});
    // Fixture is the unmodified plugin from the previous PR commit.
    const legacy=readFileSync(new URL("./fixtures/opencode-plugin-before-execution-events.txt",import.meta.url),"utf8");
    writeFileSync(target,legacy);
    const preview=invoke(home,"install","--provider","opencode","--scope","project","--root",project);
    assert.equal(preview.status,0,preview.stderr);
    assert.equal(JSON.parse(preview.stdout).operation,"replace");
    assert.equal(readFileSync(target,"utf8"),legacy);
    const upgraded=invoke(home,"install","--provider","opencode","--scope","project","--root",project,"--apply");
    assert.equal(upgraded.status,0,upgraded.stderr);
    assert.equal(JSON.parse(upgraded.stdout).operation,"replace");
    assert.match(readFileSync(target,"utf8"),/"session.execution.succeeded"/);
    assert.equal(invoke(home,"install","--provider","opencode","--scope","project","--root",project,"--apply").status,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
