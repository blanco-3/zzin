import {
  fileRegistryAbi,
  getFileRegistryContractAddress,
  getFileRegistryPublicClient,
  getFileRegistryWalletClient,
  normalizeFileHash,
} from '@/lib/file-registry';
import { getIsUserVerified } from '@worldcoin/minikit-js';
import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';

interface RegisterFileRequest {
  fileHash?: string;
  walletAddress?: string;
  worldid?: string;
  timestamp?: number;
  usedZzin?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RegisterFileRequest;
    if (!body.fileHash) {
      return NextResponse.json(
        { success: false, error: 'fileHash is required' },
        { status: 400 },
      );
    }

    if (!body.walletAddress || !isAddress(body.walletAddress)) {
      return NextResponse.json(
        { success: false, error: 'valid walletAddress is required' },
        { status: 400 },
      );
    }

    const hash = normalizeFileHash(body.fileHash);
    const worldid = body.worldid?.trim();
    const timestamp =
      typeof body.timestamp === 'number' ? Math.floor(body.timestamp) : undefined;
    const usedZzin =
      typeof body.usedZzin === 'boolean' ? body.usedZzin : undefined;

    if (!worldid) {
      return NextResponse.json(
        { success: false, error: 'worldid is required' },
        { status: 400 },
      );
    }

    if (!timestamp || timestamp <= 0) {
      return NextResponse.json(
        { success: false, error: 'valid timestamp is required' },
        { status: 400 },
      );
    }

    if (usedZzin === undefined) {
      return NextResponse.json(
        { success: false, error: 'usedZzin is required' },
        { status: 400 },
      );
    }

    const rpcUrl = process.env.FILE_REGISTRY_RPC_URL || undefined;
    const isVerifiedUser = await getIsUserVerified(body.walletAddress, rpcUrl);

    if (!isVerifiedUser) {
      return NextResponse.json(
        { success: false, error: 'Address Book verification failed' },
        { status: 403 },
      );
    }

    const contractAddress = getFileRegistryContractAddress();
    const publicClient = getFileRegistryPublicClient();
    const { walletClient, account } = getFileRegistryWalletClient();

    const txHash = await walletClient.writeContract({
      address: contractAddress,
      abi: fileRegistryAbi,
      functionName: 'registerFile',
      args: [hash, worldid, BigInt(timestamp), usedZzin],
      account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const explorerBaseUrl =
      process.env.FILE_REGISTRY_EXPLORER_BASE_URL || 'https://worldscan.org';

    return NextResponse.json({
      success: true,
      fileHash: hash,
      verifiedWalletAddress: body.walletAddress,
      worldid,
      timestamp,
      usedZzin,
      owner: account.address,
      transactionHash: txHash,
      transactionUrl: `${explorerBaseUrl}/tx/${txHash}`,
      blockNumber: receipt.blockNumber.toString(),
      network: 'worldchain',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
