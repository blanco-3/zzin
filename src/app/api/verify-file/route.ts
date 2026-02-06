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

    const hash = normalizeFileHash(body.fileHash);
    const contractAddress = getFileRegistryContractAddress();
    const publicClient = getFileRegistryPublicClient();

    const [location, worldid, timestamp, usedZzin, exists] =
      (await publicClient.readContract({
        address: contractAddress,
        abi: fileRegistryAbi,
        functionName: 'getImageMetadata',
        args: [hash],
      })) as [string, string, bigint, boolean, boolean];

    const owner = await publicClient.readContract({
      address: contractAddress,
      abi: fileRegistryAbi,
      functionName: 'getFileOwner',
      args: [hash],
    });

    const registered = Boolean(exists) && owner !== zeroAddress;

    return NextResponse.json({
      success: true,
      fileHash: hash,
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
