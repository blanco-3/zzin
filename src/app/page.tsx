'use client'
import { useState, useRef, useEffect, useCallback } from 'react';
import FileRegistryABI from '@/abi/FileRegistry.json';
import { MiniKit, VerificationLevel } from '@worldcoin/minikit-js';
import { useWaitForTransactionReceipt } from '@worldcoin/minikit-react';
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

export default function Home() {
  const [mode, setMode] = useState<'login' | 'menu' | 'camera' | 'preview' | 'register_prompt' | 'result' | 'verify' | 'verify_result' | 'verify_fail'>('login');
  const [isHumanVerified, setIsHumanVerified] = useState(false);
  const [humanVerifyStatus, setHumanVerifyStatus] = useState<string | null>(null);

  // 카메라 & 이미지
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [tempImage, setTempImage] = useState<string | null>(null); 
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [certifiedImage, setCertifiedImage] = useState<string | null>(null); // watermarked/template image
  
  // 상태
  const [isLoading, setIsLoading] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('PROCESSING...');
  const [isScanning, setIsScanning] = useState(false);
  const [chainRegistrationError, setChainRegistrationError] = useState<string | null>(null);
  const [chainRegistration, setChainRegistration] = useState<{
    fileHash?: string;
    verifiedWalletAddress?: string;
    worldid?: string;
    timestamp?: number;
    usedZzin?: boolean;
    transactionId?: string;
    transactionHash?: string;
    transactionUrl?: string;
    network?: string;
  } | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [capturedTimestamp, setCapturedTimestamp] = useState<number | null>(null);
  
  // 검증된 데이터 (온체인 매핑 기반)
  const [verifiedData, setVerifiedData] = useState<{
    registered: boolean;
    fileHash: string;
    originalHash?: string | null;
    certHash?: string | null;
    worldid?: string;
    timestamp?: number;
    usedZzin?: boolean;
    owner?: string | null;
  } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    transactionId,
  });

  // --- 1. 로그인 ---
  const verifyHumanity = async () => {
    if (!MiniKit.isInstalled()) { alert("World App 필요"); return; }
    setIsLoading(true);
    setHumanVerifyStatus('인간 인증 진행 중...');
    const verifySignal = `login-${Date.now()}`;
    try {
      const res = await MiniKit.commandsAsync.verify({
        action: 'orbgate',
        signal: verifySignal,
        verification_level: VerificationLevel.Orb,
      });
      const verified = res?.finalPayload;
      if (verified?.status !== 'success') throw new Error('Verification rejected');

      // 서버측 검증 (verifyCloudProof) 호출
      const serverRes = await fetch('/api/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: verified,
          action: 'orbgate',
          signal: verifySignal,
        })
      });
      const serverJson = await serverRes.json();
      if (!serverRes.ok || !serverJson?.verifyRes?.success) {
        const code = serverJson?.verifyRes?.code || 'unknown_error';
        const detail = serverJson?.verifyRes?.detail || '';
        throw new Error(`Server verification failed: ${code} ${detail}`);
      }

      setIsHumanVerified(true);
      setHumanVerifyStatus('인증 완료');
      setMode('menu');
    } catch (err) {
      console.warn('Human verification failed or cancelled', err);
      setIsHumanVerified(false);
      setHumanVerifyStatus('인증 실패 또는 취소됨');
      alert('Orb 인증을 완료해야 진행 가능합니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- 2. 카메라 시작 ---
  const startCamera = useCallback(async () => {
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => videoRef.current?.play();
      }
    } catch (err) { console.error("Camera fail", err); }
  }, [facingMode]);

  useEffect(() => {
    if (mode === 'camera') startCamera();
  }, [mode, startCamera]);

  // --- 3. 촬영 ---
  const capturePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(videoRef.current, 0, 0);
    setTempImage(canvas.toDataURL('image/jpeg', 1.0));
    setCapturedTimestamp(Math.floor(Date.now() / 1000));
    setMode('preview');
  };

  // --- 4. 촬영 이미지 확정 ---
  const confirmCapture = () => {
    if (!tempImage) return;
    setFinalImage(tempImage);
    setCertifiedImage(null);
    setChainRegistration(null);
    setChainRegistrationError(null);
    setMode('register_prompt');
  };

  const hashImage = async (imageSrc: string) => {
    const response = await fetch(imageSrc);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return keccak256(toHex(bytes));
  };

  const getMiniAppWalletAddress = async () => {
    const userInfo = await MiniKit.getUserInfo();
    if (!userInfo?.walletAddress) {
      throw new Error('월렛 주소를 불러오지 못했습니다.');
    }
    return userInfo.walletAddress;
  };

  const registerOnChain = async () => {
    if (!finalImage) return;

    setIsLoading(true);
    setProcessingMessage('CHECKING WORLD ID...');
    setChainRegistrationError(null);

    try {
      if (!MiniKit.isInstalled()) {
        throw new Error('World App 환경에서 실행하세요.');
      }
      if (!FILE_REGISTRY_CONTRACT_ADDRESS) {
        throw new Error('NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS가 필요합니다.');
      }

      const walletAddress = await getMiniAppWalletAddress();

      // original hash: tempImage (pre-template) if available, otherwise finalImage
      const originalHash = await hashImage(tempImage || finalImage);
      // certified hash: final templated image if available, otherwise original
      const certHash = await hashImage(certifiedImage || finalImage);
      const worldIdUser = await MiniKit.getUserByAddress(walletAddress);
      const worldid = worldIdUser.username || walletAddress;
      const timestamp = capturedTimestamp || Math.floor(Date.now() / 1000);
      const usedZzin = true;

      // World ID proof tied to the file hash (signal = fileHash)
      const verifyRes = await MiniKit.commandsAsync.verify({
        app_id: process.env.NEXT_PUBLIC_APP_ID || '',
        action: WORLD_ID_ACTION,
        signal: originalHash,
        verification_level: 'orb',
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

      setProcessingMessage('SUBMITTING TX...');
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [
          {
            address: FILE_REGISTRY_CONTRACT_ADDRESS,
            abi: FileRegistryABI,
            functionName: 'registerFile',
            args: [
              originalHash,
              certHash,
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

      setChainRegistration({
        fileHash: originalHash,
        originalHash,
        certHash,
        verifiedWalletAddress: walletAddress,
        worldid,
        timestamp,
        usedZzin,
        transactionId: finalPayload.transaction_id,
        network: 'worldchain',
      });
      setTransactionId(finalPayload.transaction_id);
      setMode('result');
    } catch (err) {
      const message = err instanceof Error ? err.message : '온체인 등록 실패';
      setChainRegistrationError(message);
    } finally {
      setIsLoading(false);
      setProcessingMessage('PROCESSING...');
    }
  };

  const skipOnChain = () => {
    setChainRegistration(null);
    setChainRegistrationError(null);
    setTransactionId('');
    setMode('result');
  };

  // --- 5. 저장 ---
  const handleSave = async () => {
    if (!finalImage) return;
    try {
        const response = await fetch(finalImage);
        const blob = await response.blob();
        
        // 기존 파일명 규칙 유지
        const file = new File([blob], "ZZIN_PROOF.jpg", { type: "image/jpeg" });
        
        if (navigator.share) {
            await navigator.share({ files: [file], title: 'ZZIN Proof' });
        } else {
             const a = document.createElement('a'); a.href = finalImage; a.download = "ZZIN_PROOF.jpg"; a.click();
        }
    } catch (err) {
      console.error('Save failed', err);
      alert("저장을 위해 화면을 꾹 눌러주세요.");
    }
  };

  // --- 6. 검증 (온체인 매핑 확인) ---
  const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      setFinalImage(url);
      setVerifyError(null);
      setVerifiedData(null);
      setMode('verify_result');

      setIsScanning(true);
      try {
        const fileHash = keccak256(toHex(new Uint8Array(await file.arrayBuffer())));
        const response = await fetch('/api/verify-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileHash }),
        });
        const data = await response.json();

        if (!response.ok || !data?.success) {
          throw new Error(data?.error || '온체인 검증 실패');
        }

        setVerifiedData({
          registered: Boolean(data.registered),
          fileHash,
          originalHash: data.originalHash || null,
          certHash: data.certHash || null,
          worldid: data.worldid || undefined,
          timestamp:
            typeof data.timestamp === 'string'
              ? Number(data.timestamp)
              : data.timestamp,
          usedZzin: typeof data.usedZzin === 'boolean' ? data.usedZzin : undefined,
          owner: data.owner || null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : '온체인 검증 실패';
        setVerifyError(message);
      } finally {
        setIsScanning(false);
      }
  };

  const goBack = () => {
    setMode('menu');
    setTempImage(null);
    setFinalImage(null);
    setCertifiedImage(null);
    setVerifiedData(null);
    setVerifyError(null);
    setChainRegistration(null);
    setChainRegistrationError(null);
    setTransactionId('');
    setCapturedTimestamp(null);
  };

  useEffect(() => {
    if (!transactionId) return;
    if (isConfirming) return;

    if (isConfirmed && confirmedTransactionHash) {
      setChainRegistration((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          transactionHash: confirmedTransactionHash,
          transactionUrl: `${FILE_REGISTRY_EXPLORER_BASE_URL}/tx/${confirmedTransactionHash}`,
        };
      });
      setTransactionId('');
      return;
    }

    if (isConfirmError) {
      setChainRegistrationError(
        confirmError?.message || '트랜잭션 확인 중 오류가 발생했습니다.',
      );
      setTransactionId('');
    }
  }, [
    transactionId,
    isConfirming,
    isConfirmed,
    isConfirmError,
    confirmedTransactionHash,
    confirmError,
  ]);

  // === 렌더링 ===

  // 1. 로그인
  if (mode === 'login') return (
    <div className="flex flex-col h-[100dvh] bg-black items-center justify-center p-8 text-center text-white">
      <h1 className="text-8xl font-black italic tracking-tighter mb-4">ZZIN.</h1>
      <div className="space-y-3 w-full">
        <button 
          onClick={verifyHumanity} 
          disabled={isLoading} 
          className={`w-full py-4 text-lg font-bold rounded-full active:scale-95 transition-all ${isHumanVerified ? 'bg-[#00ffcc] text-black' : 'bg-white text-black'}`}
        >
          {isLoading ? "Verifying..." : (isHumanVerified ? "Orb Verified" : "Verify with World ID")}
        </button>
        {humanVerifyStatus && (
          <p className="text-xs text-zinc-400">{humanVerifyStatus}</p>
        )}
      </div>
    </div>
  );

  // 2. 메뉴
  if (mode === 'menu') return (
    <div className="flex flex-col h-[100dvh] bg-black text-white p-6 justify-between">
      <div className="pt-10">
          <div className="flex justify-between items-center mb-10">
            <h1 className="text-6xl font-black italic tracking-tighter">ZZIN.</h1>
            <div className="px-3 py-1 border border-zinc-800 rounded-full text-xs font-mono text-zinc-400">
                {isHumanVerified ? 'Orb Verified' : 'Guest'}
            </div>
          </div>
          <div className="space-y-6">
            <button onClick={() => setMode('camera')} className="w-full h-48 bg-zinc-900 border border-zinc-800 rounded-[2rem] flex flex-col justify-between p-8 active:scale-[0.98] transition-all">
                <div className="text-right"><span className="text-4xl">📸</span></div>
                <div className="text-left"><h2 className="text-4xl font-black italic text-white">CAPTURE</h2></div>
            </button>
            <button onClick={() => setMode('verify')} className="w-full h-32 bg-zinc-900 border border-zinc-800 rounded-[2rem] flex items-center justify-between p-8 active:scale-[0.98] transition-all">
                <div className="text-left"><h2 className="text-3xl font-black italic text-zinc-400">VERIFY</h2></div>
                <span className="text-3xl opacity-50">🔍</span>
            </button>
          </div>
      </div>
    </div>
  );

  // 3. 카메라 / 프리뷰 / 온체인 여부 선택 / 결과
  if (['camera', 'preview', 'register_prompt', 'result'].includes(mode)) return (
    <div className="flex flex-col h-[100dvh] bg-white">
      
      {/* 뷰어 영역 */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <button onClick={goBack} className="absolute top-6 left-6 z-20 bg-black/50 text-white px-4 py-2 rounded-full text-sm font-bold backdrop-blur">✕ 닫기</button>
        {mode === 'camera' && (
            <button onClick={() => setFacingMode(p => p === 'user' ? 'environment' : 'user')} className="absolute top-6 right-6 z-20 w-10 h-10 bg-black/50 rounded-full text-white text-xl flex items-center justify-center backdrop-blur">🔄</button>
        )}

        {mode === 'camera' && <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />}
        {(mode === 'preview' && tempImage) && <img src={tempImage} className="w-full h-full object-contain" />}
        {(mode === 'register_prompt' && finalImage) && <img src={finalImage} className="w-full h-full object-contain" />}
        {(mode === 'result' && finalImage) && <img src={finalImage} className="w-full h-full object-contain" />}
      </div>

      {/* 하단 컨트롤 */}
      <div className="bg-white shrink-0 p-8 pb-10 flex flex-col items-center justify-center min-h-[160px] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-30">
        {mode === 'camera' && (
            <button onClick={capturePhoto} className="w-20 h-20 rounded-full border-[6px] border-black p-1 active:scale-95 transition-transform">
                <div className="w-full h-full bg-black rounded-full"></div>
            </button>
        )}
        {mode === 'preview' && (
            <div className="flex gap-4 w-full">
                <button onClick={() => setMode('camera')} className="flex-1 py-4 bg-gray-200 text-black font-bold rounded-2xl text-lg">다시 찍기</button>
                <button onClick={confirmCapture} className="flex-1 py-4 bg-black text-white font-black rounded-2xl text-lg">다음</button>
            </div>
        )}
        {mode === 'register_prompt' && (
            <div className="w-full space-y-3">
                <p className="text-center text-base font-bold">온체인에 해시를 등록할까요?</p>
                {chainRegistrationError && (
                  <p className="text-center text-sm text-red-600">{chainRegistrationError}</p>
                )}
                <div className="flex gap-4 w-full">
                    <button
                      onClick={skipOnChain}
                      className="flex-1 py-4 bg-gray-200 text-black font-bold rounded-2xl text-lg"
                    >
                      건너뛰기
                    </button>
                    <button
                      onClick={registerOnChain}
                      className="flex-1 py-4 bg-black text-white font-black rounded-2xl text-lg"
                    >
                      온체인 등록
                    </button>
                </div>
            </div>
        )}
        {mode === 'result' && (
            <div className="w-full space-y-3">
                {chainRegistrationError && (
                  <p className="text-center text-sm text-red-600">{chainRegistrationError}</p>
                )}
                <div className="rounded-2xl bg-zinc-100 p-3 text-xs text-zinc-700">
                  {chainRegistration?.transactionHash ? (
                    <div className="space-y-1">
                      <p>Network: {chainRegistration.network || 'worldchain'}</p>
                      <p className="break-all">Verified User: {chainRegistration.verifiedWalletAddress}</p>
                      <p className="break-all">WorldID: {chainRegistration.worldid}</p>
                      <p>Timestamp: {chainRegistration.timestamp ? new Date(chainRegistration.timestamp * 1000).toLocaleString() : '-'}</p>
                      <p>ZZIN Used: {String(chainRegistration.usedZzin)}</p>
                      <p className="break-all">File Hash: {chainRegistration.fileHash}</p>
                      <p className="break-all">Tx: {chainRegistration.transactionHash}</p>
                      {chainRegistration.transactionUrl && (
                        <a
                          href={chainRegistration.transactionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold underline"
                        >
                          Worldscan에서 확인
                        </a>
                      )}
                    </div>
                  ) : chainRegistration?.transactionId ? (
                    <div className="space-y-1">
                      <p>Network: {chainRegistration.network || 'worldchain'}</p>
                      <p className="break-all">Verified User: {chainRegistration.verifiedWalletAddress}</p>
                      <p className="break-all">WorldID: {chainRegistration.worldid}</p>
                      <p>Timestamp: {chainRegistration.timestamp ? new Date(chainRegistration.timestamp * 1000).toLocaleString() : '-'}</p>
                      <p>ZZIN Used: {String(chainRegistration.usedZzin)}</p>
                      <p className="break-all">File Hash: {chainRegistration.fileHash}</p>
                      <p className="break-all">Transaction ID: {chainRegistration.transactionId}</p>
                      <p className="text-emerald-700">트랜잭션 확인 중...</p>
                    </div>
                  ) : (
                    <p>온체인 등록을 건너뛴 이미지입니다.</p>
                  )}
                </div>
                <div className="flex gap-4 w-full">
                    <button onClick={() => setMode('camera')} className="flex-1 py-4 bg-gray-200 text-gray-500 font-bold rounded-2xl">새 촬영</button>
                    <button onClick={handleSave} className="flex-[2] py-4 bg-[#00ffcc] text-black font-black rounded-2xl text-lg flex items-center justify-center gap-2 shadow-lg">
                        <span>💾</span> 저장 / 공유
                    </button>
                </div>
            </div>
        )}
      </div>

      {/* 로딩 */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-4 border-zinc-800 border-t-white rounded-full animate-spin mb-4"></div>
            <p className="text-white font-bold text-sm tracking-widest">{processingMessage}</p>
        </div>
      )}
    </div>
  );

  // 4. 검증 파일 선택
  if (mode === 'verify') return (
    <div className="flex flex-col h-[100dvh] bg-black text-white p-6 justify-center items-center">
        <button onClick={goBack} className="absolute top-6 left-6 text-gray-500 font-bold">✕ Close</button>
        <div className="w-full max-w-xs text-center">
            <div 
                onClick={() => fileInputRef.current?.click()} 
                className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-3xl p-10 cursor-pointer active:scale-95 transition-all hover:border-white group"
            >
                <div className="text-6xl mb-4 group-hover:scale-110 transition-transform">📂</div>
                <h3 className="text-xl font-bold text-white mb-1">Load Photo</h3>
                <p className="text-zinc-500 text-xs">Tap to open gallery</p>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileLoad} className="hidden" />
            </div>
            <p className="text-zinc-600 text-xs mt-6">ZZIN으로 생성된 원본 사진만 검증 가능합니다.</p>
        </div>
    </div>
  );
  
  // 5. 검증 결과 (로직 포함)
  if (mode === 'verify_result') return (
      <div className="flex flex-col h-[100dvh] bg-black relative">
          
          {/* ★ 수정됨: 사진이랑 안 겹치게 확실한 [ < 뒤로가기 ] 박스 */}
          <button 
            onClick={goBack} 
            className="absolute top-6 left-6 z-50 bg-white text-black px-4 py-3 rounded-xl font-black shadow-xl border-2 border-black flex items-center gap-2 active:scale-95 transition-transform"
          >
             <span>←</span> BACK
          </button>

          {/* 이미지 표시 */}
          <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden bg-black/50">
            <div className={`relative transition-all duration-500 ${(!isScanning && verifiedData?.registered) ? 'border-2 border-[#00ffcc] shadow-[0_0_50px_rgba(0,255,204,0.3)]' : ''}`}>
                <img src={finalImage!} className="max-w-full max-h-[60vh] object-contain"/>
                {isScanning && (
                    <div className="absolute inset-0 border-b-2 border-[#00ffcc] animate-[scan_1.5s_ease-in-out_infinite] shadow-[0_0_20px_#00ffcc] bg-gradient-to-b from-transparent to-[#00ffcc]/10"></div>
                )}
            </div>
          </div>

          {/* 하단 데이터 결과창 */}
          <div className="min-h-[35vh] bg-zinc-900 shrink-0 flex flex-col items-center justify-center rounded-t-[2rem] p-8 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
              {isScanning ? (
                  <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-zinc-700 border-t-[#00ffcc] rounded-full animate-spin"></div>
                      <p className="text-[#00ffcc] font-mono text-xs tracking-widest">VERIFYING ON-CHAIN...</p>
                  </div>
              ) : (
                  <div className="flex flex-col items-center gap-6 w-full animate-in slide-in-from-bottom-5">

                      {verifyError ? (
                          <>
                            <div className="text-center">
                                <h2 className="text-3xl font-black italic text-red-500 tracking-tight mb-1">VERIFY ERROR</h2>
                            </div>
                            <p className="text-zinc-400 text-sm text-center">{verifyError}</p>
                          </>
                      ) : verifiedData?.registered ? (
                          // 성공 화면
                          <>
                            <div className="text-center">
                                <h2 className="text-3xl font-black italic text-white tracking-tight mb-1">CREATED BY HUMAN</h2>
                                <div className="text-[#00ffcc] text-xs font-bold tracking-widest border border-[#00ffcc] px-2 py-1 inline-block rounded">
                                    ZZIN VERIFIED
                                </div>
                            </div>

                            <div className="w-full bg-black/50 rounded-xl p-4 border border-zinc-800 space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500 text-xs font-bold">LOCATION</span>
                                    <span className="text-white font-mono text-xs truncate max-w-[150px]">{verifiedData.location}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500 text-xs font-bold">WORLDID</span>
                                    <span className="text-white font-mono text-xs">{verifiedData.worldid}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500 text-xs font-bold">TIMESTAMP</span>
                                    <span className="text-white font-mono text-xs">{verifiedData.timestamp ? new Date(verifiedData.timestamp * 1000).toLocaleString() : '-'}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500 text-xs font-bold">ZZIN USED</span>
                                    <span className="text-[#00ffcc] font-mono text-xs">{String(verifiedData.usedZzin)}</span>
                                </div>
                            </div>
                          </>
                      ) : (
                          // 실패 화면 (파일명/메타데이터 불일치)
                          <>
                             <div className="text-center">
                                <h2 className="text-3xl font-black italic text-red-500 tracking-tight mb-1">UNKNOWN SOURCE</h2>
                                <div className="text-red-500 text-xs font-bold tracking-widest border border-red-500 px-2 py-1 inline-block rounded">
                                    NOT REGISTERED
                                </div>
                            </div>
                            <p className="text-zinc-500 text-sm text-center">
                                온체인 매핑에서 해당 이미지 해시를 찾지 못했습니다.
                            </p>
                          </>
                      )}

                      <button onClick={goBack} className="w-full py-4 bg-white text-black font-bold rounded-2xl">닫기</button>
                  </div>
              )}
          </div>
      </div>
  );
}
