'use client';

import FileRegistryABI from '@/abi/FileRegistry.json';
import { Button } from '@worldcoin/mini-apps-ui-kit-react';
import { MiniKit, VerificationLevel } from '@worldcoin/minikit-js';
import { useWaitForTransactionReceipt } from '@worldcoin/minikit-react';
import { useEffect, useState } from 'react';
import { createPublicClient, decodeAbiParameters, http, keccak256, toHex } from 'viem';
import { worldchain } from 'viem/chains';

const DEFAULT_WORLDCHAIN_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public';
const FILE_REGISTRY_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS as `0x${string}` | undefined;
const FILE_REGISTRY_RPC_URL = process.env.NEXT_PUBLIC_FILE_REGISTRY_RPC_URL || DEFAULT_WORLDCHAIN_RPC_URL;
const FILE_REGISTRY_EXPLORER_BASE_URL = process.env.NEXT_PUBLIC_FILE_REGISTRY_EXPLORER_BASE_URL || 'https://worldscan.org';
const WORLD_ID_ACTION = 'orbgate';
const fileRegistryPublicClient = createPublicClient({
  chain: worldchain,
  transport: http(FILE_REGISTRY_RPC_URL),
});

interface RegisterResponse {
  success: boolean;
  error?: string;
  verifiedWalletAddress?: string;
  worldid?: string;
  timestamp?: number;
  usedZzin?: boolean;
  transactionId?: string;
  transactionHash?: string;
  transactionUrl?: string;
  network?: string;
}

interface VerifyResponse {
  success: boolean;
  error?: string;
  inputHash?: string;
  resolvedOriginalHash?: string | null;
  isCertified?: boolean | null;
  registered?: boolean;
  location?: string | null;
  worldid?: string | null;
  timestamp?: string | null;
  usedZzin?: boolean | null;
  owner?: string | null;
}

const digestFile = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return keccak256(toHex(bytes));
};

export const FileIntegrity = () => {
  const [registerFile, setRegisterFile] = useState<File | null>(null);
  const [verifyFile, setVerifyFile] = useState<File | null>(null);
  const [registerHash, setRegisterHash] = useState<string>('');
  const [verifyHash, setVerifyHash] = useState<string>('');
  const [isHashingRegister, setIsHashingRegister] = useState(false);
  const [isHashingVerify, setIsHashingVerify] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [registerResult, setRegisterResult] = useState<RegisterResponse | null>(
    null,
  );
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [registerTransactionId, setRegisterTransactionId] = useState('');
  const [usedZzin, setUsedZzin] = useState(true);
  const {
    transactionHash: confirmedTransactionHash,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isConfirmError,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    client: fileRegistryPublicClient,
    appConfig: {
      app_id: process.env.NEXT_PUBLIC_APP_ID || '',
    },
    transactionId: registerTransactionId,
  });

  useEffect(() => {
    if (!registerTransactionId) return;
    if (isConfirming) return;

    if (isConfirmed && confirmedTransactionHash) {
      setRegisterResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          transactionHash: confirmedTransactionHash,
          transactionUrl: `${FILE_REGISTRY_EXPLORER_BASE_URL}/tx/${confirmedTransactionHash}`,
        };
      });
      setRegisterTransactionId('');
      return;
    }

    if (isConfirmError) {
      setRegisterResult({
        success: false,
        error: confirmError?.message || '트랜잭션 확인 중 오류가 발생했습니다.',
      });
      setRegisterTransactionId('');
    }
  }, [
    registerTransactionId,
    isConfirming,
    isConfirmed,
    isConfirmError,
    confirmedTransactionHash,
    confirmError,
  ]);

  const handleGenerateRegisterHash = async () => {
    if (!registerFile) {
      setRegisterResult({ success: false, error: '등록할 파일을 먼저 선택하세요.' });
      return;
    }

    try {
      setIsHashingRegister(true);
      setRegisterResult(null);
      const hash = await digestFile(registerFile);
      setRegisterHash(hash);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '해시 생성 중 오류가 발생했습니다.';
      setRegisterResult({ success: false, error: message });
    } finally {
      setIsHashingRegister(false);
    }
  };

  const handleRegister = async () => {
    if (!registerHash) {
      setRegisterResult({ success: false, error: '해시를 먼저 생성하세요.' });
      return;
    }

    try {
      setIsRegistering(true);
      if (!MiniKit.isInstalled()) {
        throw new Error('World App 환경에서 실행하세요.');
      }
      if (!FILE_REGISTRY_CONTRACT_ADDRESS) {
        throw new Error('NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS가 필요합니다.');
      }

      const userInfo = await MiniKit.getUserInfo();
      if (!userInfo?.walletAddress) {
        throw new Error('월렛 주소를 불러오지 못했습니다.');
      }
      const worldIdUser = await MiniKit.getUserByAddress(userInfo.walletAddress);
      const worldid = worldIdUser.username || userInfo.walletAddress;
      const timestamp = registerFile
        ? Math.floor(registerFile.lastModified / 1000) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

      // World ID proof (Orb) bound to the file hash
      const verifyRes = await MiniKit.commandsAsync.verify({
        action: WORLD_ID_ACTION,
        signal: registerHash,
        verification_level: VerificationLevel.Orb,
      });
      const proofPayload = verifyRes?.finalPayload;
      if (proofPayload?.status !== 'success') {
        throw new Error('World ID 인증에 실패했습니다.');
      }

      const decodedProof = decodeAbiParameters(
        [{ type: 'uint256[8]' }],
        proofPayload.proof as `0x${string}`,
      )[0] as readonly bigint[];
      const merkleRoot = BigInt(proofPayload.merkle_root);
      const nullifierHash = BigInt(proofPayload.nullifier_hash);

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: FILE_REGISTRY_CONTRACT_ADDRESS,
            abi: FileRegistryABI,
            functionName: 'registerFile',
            args: [
              registerHash,
              worldid,
              BigInt(timestamp),
              usedZzin,
              merkleRoot,
              nullifierHash,
              decodedProof,
            ],
          },
        ],
      });
      if (finalPayload.status !== 'success') {
        throw new Error('트랜잭션이 거절되었거나 제출에 실패했습니다.');
      }

      setRegisterResult({
        success: true,
        verifiedWalletAddress: userInfo.walletAddress,
        worldid,
        timestamp,
        usedZzin,
        transactionId: finalPayload.transaction_id,
        network: 'worldchain',
      });
      setRegisterTransactionId(finalPayload.transaction_id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '블록체인 등록 중 오류가 발생했습니다.';
      setRegisterResult({ success: false, error: message });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleGenerateVerifyHash = async () => {
    if (!verifyFile) {
      setVerifyResult({ success: false, error: '검증할 파일을 먼저 선택하세요.' });
      return;
    }

    try {
      setIsHashingVerify(true);
      setVerifyResult(null);
      const hash = await digestFile(verifyFile);
      setVerifyHash(hash);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '해시 생성 중 오류가 발생했습니다.';
      setVerifyResult({ success: false, error: message });
    } finally {
      setIsHashingVerify(false);
    }
  };

  const handleVerify = async () => {
    if (!verifyHash) {
      setVerifyResult({ success: false, error: '해시를 먼저 생성하세요.' });
      return;
    }

    try {
      setIsVerifying(true);
      const response = await fetch('/api/verify-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileHash: verifyHash }),
      });
      const data = (await response.json()) as VerifyResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || '검증에 실패했습니다.');
      }

      setVerifyResult(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '검증 중 오류가 발생했습니다.';
      setVerifyResult({ success: false, error: message });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="grid w-full gap-6 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-lg font-semibold">File Integrity (On-chain Keccak-256)</p>

      <div className="grid gap-3 rounded-lg border border-gray-200 p-4">
        <p className="font-semibold">1) 파일 등록</p>
        <input
          type="file"
          onChange={(event) => setRegisterFile(event.target.files?.[0] || null)}
          className="w-full text-sm"
        />
        <Button
          onClick={handleGenerateRegisterHash}
          disabled={!registerFile || isHashingRegister}
          size="lg"
          variant="secondary"
          className="w-full"
        >
          {isHashingRegister ? '해시 생성 중...' : 'Keccak-256 해시 생성'}
        </Button>
        {registerHash && (
          <p className="break-all text-xs text-gray-700">Hash: {registerHash}</p>
        )}
        <Button
          onClick={handleRegister}
          disabled={!registerHash || isRegistering || !!registerTransactionId}
          size="lg"
          variant="primary"
          className="w-full"
        >
          {isRegistering
            ? '트랜잭션 제출 중...'
            : registerTransactionId
              ? '트랜잭션 확인 중...'
              : '해시 등록'}
        </Button>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={usedZzin}
            onChange={(event) => setUsedZzin(event.target.checked)}
          />
          ZZIN으로 생성한 파일
        </label>
        {registerResult?.error && (
          <p className="text-sm text-red-600">오류: {registerResult.error}</p>
        )}
        {registerResult?.success && (
          <div className="grid gap-1 text-xs text-green-700">
            <p>등록 완료</p>
            <p>Network: {registerResult.network || 'worldchain'}</p>
            <p className="break-all">
              Verified User: {registerResult.verifiedWalletAddress}
            </p>
            <p className="break-all">WorldID: {registerResult.worldid}</p>
            <p>
              Timestamp:{' '}
              {registerResult.timestamp
                ? new Date(registerResult.timestamp * 1000).toLocaleString()
                : '-'}
            </p>
            <p>ZZIN Used: {String(registerResult.usedZzin)}</p>
            {registerResult.transactionHash ? (
              <p className="break-all">Tx: {registerResult.transactionHash}</p>
            ) : (
              <p className="break-all">Transaction ID: {registerResult.transactionId}</p>
            )}
            {registerResult.transactionUrl && (
              <a
                href={registerResult.transactionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline"
              >
                Worldscan에서 트랜잭션 보기
              </a>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 rounded-lg border border-gray-200 p-4">
        <p className="font-semibold">2) 파일 검증</p>
        <input
          type="file"
          onChange={(event) => setVerifyFile(event.target.files?.[0] || null)}
          className="w-full text-sm"
        />
        <Button
          onClick={handleGenerateVerifyHash}
          disabled={!verifyFile || isHashingVerify}
          size="lg"
          variant="secondary"
          className="w-full"
        >
          {isHashingVerify ? '해시 생성 중...' : 'Keccak-256 해시 생성'}
        </Button>
        {verifyHash && (
          <p className="break-all text-xs text-gray-700">Hash: {verifyHash}</p>
        )}
        <Button
          onClick={handleVerify}
          disabled={!verifyHash || isVerifying}
          size="lg"
          variant="tertiary"
          className="w-full"
        >
          {isVerifying ? '검증 중...' : '등록 여부 검증'}
        </Button>
        {verifyResult?.error && (
          <p className="text-sm text-red-600">오류: {verifyResult.error}</p>
        )}
        {verifyResult?.success && (
          <div className="grid gap-1 text-xs">
            <p>
              상태:{' '}
              {verifyResult.registered
                ? verifyResult.isCertified
                  ? '등록된 인증서 해시 (원본으로 resolve)'
                  : '등록된 원본 해시'
                : '미등록 파일'}
            </p>
            {verifyResult.registered && (
              <p className="break-all">
                Input Hash: {verifyResult.inputHash || verifyHash}
              </p>
            )}
            {verifyResult.registered && verifyResult.resolvedOriginalHash && (
              <p className="break-all">
                Original Hash: {verifyResult.resolvedOriginalHash}
              </p>
            )}
            {verifyResult.registered && (
              <p className="break-all">Location: {verifyResult.location}</p>
            )}
            {verifyResult.registered && (
              <p className="break-all">WorldID: {verifyResult.worldid}</p>
            )}
            {verifyResult.registered && (
              <p>
                Timestamp:{' '}
                {verifyResult.timestamp
                  ? new Date(Number(verifyResult.timestamp) * 1000).toLocaleString()
                  : '-'}
              </p>
            )}
            {verifyResult.registered && (
              <p>ZZIN Used: {String(verifyResult.usedZzin)}</p>
            )}
            <p className="break-all">
              Owner: {verifyResult.owner || '등록된 소유자 없음'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
