// Explicit temporary diagnostic container + isolated S3-prefix measurement.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha } from './hash.mjs';

const [flag, profile, bucket, region, account, instance] = process.argv.slice(2);
assert.equal(flag, '--scratch-run');
assert.ok(
  [profile, bucket, region].every((s) => typeof s === 'string' && /^[a-zA-Z0-9_.-]+$/.test(s))
);
assert.match(account || '', /^\d{12}$/);
assert.match(instance || '', /^i-[a-f0-9]+$/);
const own = dirname(fileURLToPath(import.meta.url));
const output =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-regional-aws-'));
mkdirSync(output, { recursive: true });
function aws(args, { json = true } = {}) {
  try {
    const out = execFileSync(
      'aws',
      [...args, '--profile', profile, '--region', region, ...(json ? ['--output', 'json'] : [])],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    );
    return json ? JSON.parse(out || '{}') : out.trim();
  } catch {
    throw new Error(`AWS ${args[0]} ${args[1]} request failed`);
  }
}
assert.equal(aws(['sts', 'get-caller-identity']).Account, account);
aws(['s3api', 'head-bucket', '--bucket', bucket, '--expected-bucket-owner', account]);
const nonce = randomUUID(),
  prefix = `maude-sync-conformance/${nonce}`;
const report = {
  status: 'preparing',
  account,
  bucket,
  region,
  instance,
  prefix,
  commandId: null,
  cleanup: null,
  started: new Date().toISOString(),
};
const reportFile = join(output, 'evidence.json');
const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2));
save();
const inventory = () => {
  const data = aws([
    's3api',
    'list-object-versions',
    '--bucket',
    bucket,
    '--prefix',
    `${prefix}/`,
    '--expected-bucket-owner',
    account,
  ]);
  return [...(data.Versions || []), ...(data.DeleteMarkers || [])];
};
assert.equal(inventory().length, 0);
let terminal = false;
let sendAttempted = false;
const commandFile = join(output, 'command-private.json');
try {
  const artifact = join(own, 'dist/regional-probe.mjs');
  const bytes = readFileSync(artifact);
  assert.ok(bytes.length <= 1024 * 1024);
  report.bundleHash = sha(bytes);
  report.bundleBytes = bytes.length;
  const key = `${prefix}/diagnostic/regional-probe.mjs`;
  aws([
    's3api',
    'put-object',
    '--bucket',
    bucket,
    '--key',
    key,
    '--body',
    artifact,
    '--if-none-match',
    '*',
    '--expected-bucket-owner',
    account,
  ]);
  // This presigned URL grants short-lived read access only to the synthetic diagnostic code.
  const url = aws(['s3', 'presign', `s3://${bucket}/${key}`, '--expires-in', '600'], {
    json: false,
  });
  const options = {
    url,
    bucket,
    region,
    prefix,
    hash: report.bundleHash,
    name: `maude-sync-probe-${nonce.slice(0, 8)}`,
  };
  const python = `import hashlib,json,pathlib,subprocess,tempfile,urllib.request
C=json.loads(${JSON.stringify(JSON.stringify(options))})
name=C['name']
try:
    image=subprocess.check_output(['docker','inspect','maude-hub','--format','{{.Image}}'],text=True).strip()
    # Only the existing hub's S3 fields enter memory; never print credentials or pass them in argv.
    source="const e=process.env;process.stdout.write(JSON.stringify({endpoint:e.MAUDE_S3_ENDPOINT,bucket:e.MAUDE_S3_BUCKET,region:e.MAUDE_S3_REGION||'auto',accessKeyId:e.MAUDE_S3_ACCESS_KEY_ID,secretAccessKey:e.MAUDE_S3_SECRET_ACCESS_KEY,sessionToken:e.MAUDE_S3_SESSION_TOKEN}))"
    cfg=json.loads(subprocess.check_output(['docker','exec','maude-hub','node','-e',source],text=True))
    assert cfg['bucket']==C['bucket'] and cfg['region']==C['region']
    assert cfg['accessKeyId'] and cfg['secretAccessKey']
    cfg['endpoint']='https://s3.'+C['region']+'.amazonaws.com'
    with tempfile.TemporaryDirectory(prefix='maude-sync-regional-') as root:
        data=urllib.request.urlopen(C['url'],timeout=20).read(1048577)
        assert len(data)<=1048576 and hashlib.sha256(data).hexdigest()==C['hash']
        path=pathlib.Path(root)/'regional.mjs';path.write_bytes(data)
        # The hub image runs as an unprivileged user. Only diagnostic code lives here.
        path.chmod(0o644);pathlib.Path(root).chmod(0o755)
        args=['docker','run','--rm','--pull=never','--name',name,'--label','maude.probe=sync-regional',
              '--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','32',
              '--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,size=32m',
              '--mount','type=bind,source='+root+',target=/probe,readonly','--workdir','/tmp',
              '--entrypoint','node','-i',image,'--max-old-space-size=160','/probe/regional.mjs']
        result=subprocess.run(args,input=json.dumps({'cfg':cfg,'prefix':C['prefix']}),text=True,capture_output=True,timeout=150)
        if result.returncode: raise RuntimeError('diagnostic exit '+str(result.returncode)+': '+result.stderr[:300])
        parsed=json.loads(result.stdout)
        parsed['imageId']=image;parsed['containerLimits']={'cpus':1,'memoryMiB':256,'readOnly':True}
        print(json.dumps(parsed))
except Exception as error:
    print(json.dumps({'status':'failed','type':type(error).__name__,'message':str(error)[:300]}))
    raise SystemExit(1)
finally:
    # Only the exact diagnostic container is eligible; no hub/render stop or restart.
    subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
`;
  const payload = {
    DocumentName: 'AWS-RunShellScript',
    InstanceIds: [instance],
    Comment:
      'Maude isolated sync metadata benchmark; existing image; synthetic S3 prefix; no service change',
    Parameters: {
      commands: [`python3 - <<'MAUDE_PROBE'\n${python}\nMAUDE_PROBE`],
      executionTimeout: ['210'],
    },
  };
  writeFileSync(commandFile, JSON.stringify(payload), { mode: 0o600 });
  // A failed observation of SendCommand can still have started remote work.
  sendAttempted = true;
  report.status = 'dispatching';
  save();
  const sent = aws(['ssm', 'send-command', '--cli-input-json', `file://${commandFile}`]);
  report.commandId = sent.Command.CommandId;
  report.status = 'running';
  save();
  console.log(
    JSON.stringify({ commandId: report.commandId, prefix, bundleHash: report.bundleHash })
  );
  const until = Date.now() + 300000;
  while (Date.now() < until) {
    let status;
    try {
      status = aws([
        'ssm',
        'get-command-invocation',
        '--command-id',
        report.commandId,
        '--instance-id',
        instance,
      ]);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    if (['Pending', 'InProgress', 'Delayed', 'Cancelling'].includes(status.Status)) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    terminal = true;
    report.ssmStatus = status.Status;
    try {
      report.probe = JSON.parse(status.StandardOutputContent.trim());
    } catch {
      report.probe = { status: 'failed', message: 'Missing or truncated JSON result' };
    }
    report.status =
      status.Status === 'Success' && report.probe.status === 'passed' ? 'passed' : 'failed';
    if (report.status === 'failed') process.exitCode = 1;
    break;
  }
  if (!terminal) {
    report.status = 'observation-pending';
    process.exitCode = 2;
  }
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  // An observation failure is not remote termination. Leave objects while the exact job may run.
  if (terminal || !sendAttempted) {
    try {
      const created = inventory();
      assert.ok(created.length <= 256);
      for (const item of created) {
        assert.ok(item.Key.startsWith(`${prefix}/`) && item.VersionId);
      }
      if (created.length) {
        const deleted = aws([
          's3api',
          'delete-objects',
          '--bucket',
          bucket,
          '--delete',
          JSON.stringify({ Objects: created.map(({ Key, VersionId }) => ({ Key, VersionId })) }),
          '--expected-bucket-owner',
          account,
        ]);
        assert.equal((deleted.Errors || []).length, 0);
      }
      const remaining = inventory();
      assert.equal(remaining.length, 0);
      report.cleanup = { status: 'passed', deletedVersions: created.length, remaining: 0 };
    } catch {
      report.cleanup = { status: 'failed', prefix };
      report.status = 'failed';
      process.exitCode = 1;
    }
  } else report.cleanup = { status: 'pending-remote-termination', commandId: report.commandId };
  rmSync(commandFile, { force: true });
  report.finished = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      status: report.status,
      ssmStatus: report.ssmStatus,
      cleanup: report.cleanup,
      evidence: output,
    })
  );
}
