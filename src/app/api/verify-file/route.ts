import {
  fileRegistryAbi,
  getFileRegistryContractAddress,
  getFileRegistryPublicClient,
  normalizeFileHash,
} from '@/lib/file-registry';
import { NextRequest, NextResponse } from 'next/server';
import { zeroAddress } from 'viem';

interface VerifyFileRequest {
  fileHash?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VerifyFileRequest;
    if (!body.fileHash) {
      return NextResponse.json(
        { success: false, error: 'fileHash is required' },
        { status: 400 },
      );
    }

    const inputHash = normalizeFileHash(body.fileHash);
    const contractAddress = getFileRegistryContractAddress();
    const publicClient = getFileRegistryPublicClient();

    console.log('[verify-file] input', { inputHash, contractAddress });

    const originalHash = (await publicClient.readContract({
      address: contractAddress,
      abi: fileRegistryAbi,
      functionName: 'resolveOriginalHash',
      args: [inputHash],
    })) as string;

    const resolved =
      originalHash &&
      typeof originalHash === 'string' &&
      originalHash !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ? (originalHash as `0x${string}`)
        : null;

    if (!resolved) {
      console.log('[verify-file] not found', { inputHash, originalHash });
      return NextResponse.json({
        success: true,
        inputHash,
        resolvedOriginalHash: null,
        registered: false,
        location: null,
        worldid: null,
        timestamp: null,
        usedZzin: null,
        owner: null,
        isCertified: null,
      });
    }

    const isCertified = resolved.toLowerCase() !== inputHash.toLowerCase();

    const [location, worldid, timestamp, usedZzin, exists] = (await publicClient.readContract({
      address: contractAddress,
      abi: fileRegistryAbi,
      functionName: 'getImageMetadata',
      args: [resolved],
    })) as [string, string, bigint, boolean, boolean];

    const owner = await publicClient.readContract({
      address: contractAddress,
      abi: fileRegistryAbi,
      functionName: 'getFileOwner',
      args: [resolved],
    });

    const registered = Boolean(exists) && owner !== zeroAddress;

    console.log('[verify-file] resolved', {
      inputHash,
      resolved,
      isCertified,
      registered,
      owner,
      location,
      worldid,
      timestamp: timestamp.toString(),
      usedZzin,
      exists,
    });

    return NextResponse.json({
      success: true,
      inputHash,
      resolvedOriginalHash: resolved,
      isCertified,
      registered,
      location: registered ? location : null,
      worldid: registered ? worldid : null,
      timestamp: registered ? timestamp.toString() : null,
      usedZzin: registered ? usedZzin : null,
      owner: registered ? owner : null,
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
