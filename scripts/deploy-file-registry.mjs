import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { worldchain, worldchainSepolia } from 'viem/chains';

const rootDir = process.cwd();
const tempBuildDir = path.join(rootDir, '.tmp-solc');
const envLocalPath = path.join(rootDir, '.env.local');

const loadEnvLocal = () => {
  if (!fs.existsSync(envLocalPath)) return;
  const raw = fs.readFileSync(envLocalPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

// Allow local, non-committed env config (e.g. DEPLOYER_PRIVATE_KEY) without
// requiring users to inline secrets in shell commands.
loadEnvLocal();

const chainByKey = {
  worldchain,
  worldchainSepolia,
};
const deployChainKey = process.env.DEPLOY_CHAIN || 'worldchainSepolia';
const deployChain = chainByKey[deployChainKey];

if (!deployChain) {
  throw new Error(
    `Invalid DEPLOY_CHAIN: ${deployChainKey}. Use "worldchainSepolia" or "worldchain".`,
  );
}
const deployRpcUrl =
  process.env.DEPLOY_RPC_URL || deployChain.rpcUrls.default.http[0];
const explorerUrl = deployChain.blockExplorers.default.url.replace(/\/$/, '');
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

if (!deployerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
  throw new Error('Missing or invalid DEPLOYER_PRIVATE_KEY');
}

const worldIdRouterByChainKey = {
  worldchain: '0x17B354dD2595411ff79041f930e491A4Df39A278',
  worldchainSepolia: '0x57f928158C3EE7CDad1e4D8642503c4D0201f611',
};

const worldIdRouter =
  process.env.WORLD_ID_ROUTER ||
  worldIdRouterByChainKey[deployChainKey];
const worldIdAppId = process.env.WORLD_ID_APP_ID || process.env.NEXT_PUBLIC_APP_ID;
const worldIdAction = process.env.WORLD_ID_ACTION || process.env.NEXT_PUBLIC_ACTION || 'orbgate';

if (!worldIdRouter || !/^0x[0-9a-fA-F]{40}$/.test(worldIdRouter)) {
  throw new Error(
    `Missing or invalid WORLD_ID_ROUTER. Provide env WORLD_ID_ROUTER, or use a supported DEPLOY_CHAIN (${Object.keys(worldIdRouterByChainKey).join(
      ', ',
    )}).`,
  );
}
if (!worldIdAppId || !/^app_[a-zA-Z0-9]+$/.test(worldIdAppId)) {
  throw new Error('Missing or invalid WORLD_ID_APP_ID (expected like app_xxx)');
}
if (!worldIdAction || typeof worldIdAction !== 'string') {
  throw new Error('Missing WORLD_ID_ACTION');
}

const compileContract = () => {
  execSync(
    'npx --yes solc --abi --bin contracts/FileRegistry.sol -o .tmp-solc',
    { cwd: rootDir, stdio: 'inherit' },
  );

  const abiPath = path.join(
    tempBuildDir,
    'contracts_FileRegistry_sol_FileRegistry.abi',
  );
  const binPath = path.join(
    tempBuildDir,
    'contracts_FileRegistry_sol_FileRegistry.bin',
  );

  if (!fs.existsSync(abiPath) || !fs.existsSync(binPath)) {
    throw new Error('Contract compile output not found');
  }

  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const bytecode = `0x${fs.readFileSync(binPath, 'utf8').trim()}`;

  const abiOutputPath = path.join(rootDir, 'src/abi/FileRegistry.json');
  fs.writeFileSync(abiOutputPath, `${JSON.stringify(abi, null, 2)}\n`);

  for (const tempFile of fs.readdirSync(tempBuildDir)) {
    fs.unlinkSync(path.join(tempBuildDir, tempFile));
  }
  fs.rmdirSync(tempBuildDir);

  return { abi, bytecode };
};

const updateEnvLocal = (updates) => {
  const existing = fs.existsSync(envLocalPath)
    ? fs.readFileSync(envLocalPath, 'utf8')
    : '';
  const lines = existing ? existing.split('\n') : [];

  for (const [key, value] of Object.entries(updates)) {
    const nextLine = `${key}='${value}'`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      lines.push(nextLine);
    }
  }

  const finalContent = `${lines.filter(Boolean).join('\n')}\n`;
  fs.writeFileSync(envLocalPath, finalContent);
};

const main = async () => {
  console.log(`Deploy chain: ${deployChain.name}`);
  console.log(`RPC: ${deployRpcUrl}`);

  const { abi, bytecode } = compileContract();
  const account = privateKeyToAccount(deployerPrivateKey);
  const walletClient = createWalletClient({
    account,
    chain: deployChain,
    transport: http(deployRpcUrl),
  });
  const publicClient = createPublicClient({
    chain: deployChain,
    transport: http(deployRpcUrl),
  });

  const deployTxHash = await walletClient.deployContract({
    abi,
    bytecode,
    account,
    args: [worldIdRouter, worldIdAppId, worldIdAction],
  });

  console.log(`Deploy tx submitted: ${deployTxHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deployTxHash,
  });
  const contractAddress = receipt.contractAddress;

  if (!contractAddress) {
    throw new Error('Contract address not found in deploy receipt');
  }

  updateEnvLocal({
    NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS: contractAddress,
    NEXT_PUBLIC_FILE_REGISTRY_RPC_URL: deployRpcUrl,
    NEXT_PUBLIC_FILE_REGISTRY_EXPLORER_BASE_URL: explorerUrl,
    FILE_REGISTRY_CONTRACT_ADDRESS: contractAddress,
    FILE_REGISTRY_RPC_URL: deployRpcUrl,
    FILE_REGISTRY_EXPLORER_BASE_URL: explorerUrl,
  });

  console.log('\nDeployment complete');
  console.log(`Contract: ${contractAddress}`);
  console.log(`Explorer: ${explorerUrl}/address/${contractAddress}`);
  console.log(`Deploy tx: ${explorerUrl}/tx/${deployTxHash}`);
  console.log(`.env.local updated: ${path.relative(rootDir, envLocalPath)}`);
};

main().catch((error) => {
  const details = `${error?.details || ''} ${error?.cause?.details || ''}`;
  const normalizedDetails = details.toLowerCase();

  if (
    normalizedDetails.includes('insufficient funds') ||
    normalizedDetails.includes('allowance (0)')
  ) {
    console.error(
      'Deployment failed: deployer wallet has no gas funds on this chain. Fund the wallet and retry.',
    );
  } else {
    console.error(error?.shortMessage || error?.message || error);
  }
  process.exit(1);
});
