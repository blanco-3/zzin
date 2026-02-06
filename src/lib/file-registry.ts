import FileRegistryABI from '@/abi/FileRegistry.json';
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { worldchain } from 'viem/chains';

const DEFAULT_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public';

export const normalizeFileHash = (fileHash: string): Hex => {
  const normalized = fileHash.trim().toLowerCase();
  const isValidHash = /^0x[0-9a-f]{64}$/.test(normalized);

  if (!isValidHash) {
    throw new Error('fileHash must be a 32-byte hex string (0x + 64 chars)');
  }

  return normalized as Hex;
};

export const getFileRegistryContractAddress = (): Address => {
  const contractAddress = process.env.FILE_REGISTRY_CONTRACT_ADDRESS;
  if (!contractAddress || !isAddress(contractAddress)) {
    throw new Error('Missing or invalid FILE_REGISTRY_CONTRACT_ADDRESS');
  }

  return contractAddress;
};

export const getFileRegistryPublicClient = () => {
  const rpcUrl = process.env.FILE_REGISTRY_RPC_URL || DEFAULT_RPC_URL;
  return createPublicClient({
    chain: worldchain,
    transport: http(rpcUrl),
  });
};

export const getFileRegistryAccount = () => {
  const privateKey = process.env.FILE_REGISTRY_PRIVATE_KEY;
  const isValidPrivateKey = !!privateKey && /^0x[0-9a-fA-F]{64}$/.test(privateKey);

  if (!isValidPrivateKey) {
    throw new Error('Missing or invalid FILE_REGISTRY_PRIVATE_KEY');
  }

  return privateKeyToAccount(privateKey as Hex);
};

export const getFileRegistryWalletClient = () => {
  const rpcUrl = process.env.FILE_REGISTRY_RPC_URL || DEFAULT_RPC_URL;
  const account = getFileRegistryAccount();

  const walletClient = createWalletClient({
    account,
    chain: worldchain,
    transport: http(rpcUrl),
  });

  return { walletClient, account };
};

export const fileRegistryAbi = FileRegistryABI;
