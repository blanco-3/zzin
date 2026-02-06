'use client'
import { useState, useRef, useEffect, useCallback } from 'react';
import FileRegistryWriteABI from '@/abi/FileRegistryWrite.json';
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
  const [mode, setMode] = useState<'login' | 'menu' | 'camera' | 'preview' | 'cert_select' | 'register_prompt' | 'result' | 'verify' | 'verify_result' | 'verify_fail'>('login');
  const [isHumanVerified, setIsHumanVerified] = useState(false);
  const [humanVerifyStatus, setHumanVerifyStatus] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);

  // 카메라 & 이미지
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [tempImage, setTempImage] = useState<string | null>(null);
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [certifiedImage, setCertifiedImage] = useState<string | null>(null);
  const [originalHash, setOriginalHash] = useState<string | null>(null);
  const [certifiedHash, setCertifiedHash] = useState<string | null>(null);
  const [capturedWorldid, setCapturedWorldid] = useState<string | null>(null);

  // 상태
  const [isLoading, setIsLoading] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('PROCESSING...');
  const [isScanning, setIsScanning] = useState(false);
  const [chainRegistrationError, setChainRegistrationError] = useState<string | null>(null);
  const [chainRegistration, setChainRegistration] = useState<{
    originalHash?: string;
    certifiedHash?: string;
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
    inputHash: string;
    resolvedOriginalHash: string | null;
    isCertified: boolean | null;
    location?: string;
    worldid?: string;
    timestamp?: number;
    usedZzin?: boolean;
    owner?: string | null;
  } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyHint, setVerifyHint] = useState<string | null>(null);
  const [manualVerifyHash, setManualVerifyHash] = useState<string>('');
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [manualVerifyHint, setManualVerifyHint] = useState<string | null>(null);
  const [barCertImage, setBarCertImage] = useState<string | null>(null);
  const [verticalCertImage, setVerticalCertImage] = useState<string | null>(null);
  const [barCertHash, setBarCertHash] = useState<string | null>(null);
  const [verticalCertHash, setVerticalCertHash] = useState<string | null>(null);

  useEffect(() => {
    try {
      const enabled = new URLSearchParams(window.location.search).get('debug') === '1';
      setDebugEnabled(enabled);
      if (enabled) console.log('[ZZIN][debug] enabled via ?debug=1');
    } catch { /* ignore */ }
  }, []);

  const debugGroup = (title: string, details?: unknown) => {
    if (!debugEnabled) return;
    console.groupCollapsed(`[ZZIN][debug] ${title}`);
    if (details !== undefined) console.log(details);
    console.groupEnd();
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manualVerifyInputRef = useRef<HTMLInputElement>(null);
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

  // --- 4. 촬영 이미지 확정 (인증서 두 종류 모두 생성) ---
  const confirmCapture = async () => {
    if (!tempImage) return;
    setIsLoading(true);
    setProcessingMessage('GENERATING CERTIFICATES...');
    setChainRegistration(null);
    setChainRegistrationError(null);

    try {
      if (!MiniKit.isInstalled()) throw new Error('World App 환경에서 실행하세요.');
      const addr = await getMiniAppWalletAddress();
      const worldIdUser = await MiniKit.getUserByAddress(addr);
      const worldid = worldIdUser.username || addr;
      const timestamp = capturedTimestamp || Math.floor(Date.now() / 1000);

      const oHash = await hashImage(tempImage);
      debugGroup('confirmCapture: original hash', { addr, worldid, timestamp, originalHash: oHash });

      // Generate both certificate formats
      const [barDataUrl, vertDataUrl] = await Promise.all([
        createCertifiedImageDataUrl({ baseImageSrc: tempImage, worldid, timestamp, originalHash: oHash, format: 'bar' }),
        createCertifiedImageDataUrl({ baseImageSrc: tempImage, worldid, timestamp, originalHash: oHash, format: 'vertical' }),
      ]);
      const [bHash, vHash] = await Promise.all([hashImage(barDataUrl), hashImage(vertDataUrl)]);
      debugGroup('confirmCapture: both hashes', { barHash: bHash, verticalHash: vHash });

      setOriginalImage(tempImage);
      setOriginalHash(oHash);
      setCapturedWorldid(worldid);
      setBarCertImage(barDataUrl);
      setVerticalCertImage(vertDataUrl);
      setBarCertHash(bHash);
      setVerticalCertHash(vHash);
      setMode('cert_select');
    } catch (err) {
      const message = err instanceof Error ? err.message : '인증서 생성 실패';
      setChainRegistrationError(message);
      setOriginalImage(tempImage);
      setCertifiedImage(null);
      setFinalImage(tempImage);
      setCapturedWorldid(null);
      setOriginalHash(null);
      setCertifiedHash(null);
      setMode('register_prompt');
    } finally {
      setIsLoading(false);
      setProcessingMessage('PROCESSING...');
    }
  };

  const selectCertificate = (format: 'bar' | 'vertical') => {
    const img = format === 'bar' ? barCertImage : verticalCertImage;
    const hash = format === 'bar' ? barCertHash : verticalCertHash;
    setCertifiedImage(img);
    setCertifiedHash(hash);
    setFinalImage(img);
    setMode('register_prompt');
  };

  const hashImage = async (imageSrc: string) => {
    const response = await fetch(imageSrc);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return keccak256(toHex(bytes));
  };

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = src;
    });

  const createCertifiedImageDataUrl = async ({
    baseImageSrc, worldid, timestamp, originalHash: oHash, format,
  }: { baseImageSrc: string; worldid: string; timestamp: number; originalHash: string; format: 'bar' | 'vertical'; }) => {
    const img = await loadImage(baseImageSrc);
    const now = new Date(timestamp * 1000);
    const datetime = now.toISOString().slice(0, 10).replace(/-/g, '.') + '  ' + now.toTimeString().slice(0, 8);
    void worldid; void oHash; // used for future metadata

    const renderSvgToImage = async (svgString: string) => {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const svgImg = await loadImage(url);
      URL.revokeObjectURL(url);
      return svgImg;
    };

    if (format === 'bar') {
      // === Bar (가로): 원본 + 하단 워터마크 바 ===
      const barHeight = Math.round(img.width * (56 / 924));
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height + barHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      ctx.drawImage(img, 0, 0);
      const svgImg = await renderSvgToImage(generateWatermarkSvg('bottom', datetime));
      ctx.drawImage(svgImg, 0, img.height, img.width, barHeight);
      return canvas.toDataURL('image/jpeg', 0.95);
    }

    // === Vertical (세로): 원본 + 오른쪽 사이드 바 ===
    const sideBarWidth = Math.round(img.height * (56 / 924));
    const canvas = document.createElement('canvas');
    canvas.width = img.width + sideBarWidth;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0);
    const svgImg = await renderSvgToImage(generateWatermarkSvg('side', datetime));
    ctx.drawImage(svgImg, img.width, 0, sideBarWidth, img.height);
    return canvas.toDataURL('image/jpeg', 0.95);
  };

  const shareDataUrl = async (dataUrl: string, filename: string) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    if (navigator.share) {
      await navigator.share({ files: [file], title: filename });
    } else {
      const a = document.createElement('a');
      a.href = dataUrl; a.download = filename; a.click();
    }
  };

  const getMiniAppWalletAddress = async () => {
    const maybeFromMiniKit =
      walletAddress || MiniKit.user?.walletAddress ||
      // @ts-expect-error minikit-js runtime fallback
      MiniKit.walletAddress ||
      // @ts-expect-error window provider fallback
      window?.MiniKit?.walletAddress;
    if (typeof maybeFromMiniKit === 'string' && maybeFromMiniKit.length > 0) {
      return maybeFromMiniKit;
    }
    const userInfo = await MiniKit.getUserInfo();
    if (!userInfo?.walletAddress) {
      throw new Error('월렛 주소를 불러오지 못했습니다.');
    }
    return userInfo.walletAddress;
  };

  const ensureWalletConnected = async () => {
    if (!MiniKit.isInstalled()) throw new Error('World App 환경에서 실행하세요.');
    if (walletAddress) return walletAddress;

    setIsLoading(true);
    setProcessingMessage('CONNECTING WALLET...');
    setWalletStatus('지갑 연결 중...');
    try {
      const nonce = crypto.randomUUID().replace(/-/g, '');
      const result = await MiniKit.commandsAsync.walletAuth({
        nonce,
        expirationTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notBefore: new Date(Date.now() - 24 * 60 * 60 * 1000),
        statement: `Connect wallet (${crypto.randomUUID().replace(/-/g, '')}).`,
      });
      if (!result || result.finalPayload.status !== 'success') {
        throw new Error('지갑 연결을 취소했거나 실패했습니다.');
      }
      setWalletAddress(result.finalPayload.address);
      setWalletStatus('지갑 연결 완료');
      return result.finalPayload.address;
    } finally {
      setIsLoading(false);
      setProcessingMessage('PROCESSING...');
    }
  };

  const registerOnChain = async () => {
    if (!finalImage) return;

    setIsLoading(true);
    setProcessingMessage('CHECKING WORLD ID...');
    setChainRegistrationError(null);

    try {
      if (!MiniKit.isInstalled()) throw new Error('World App 환경에서 실행하세요.');
      if (!FILE_REGISTRY_CONTRACT_ADDRESS) throw new Error('NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS가 필요합니다.');

      await ensureWalletConnected();
      const addr = await getMiniAppWalletAddress();
      const worldid = capturedWorldid || (await MiniKit.getUserByAddress(addr)).username || addr;
      const timestamp = capturedTimestamp || Math.floor(Date.now() / 1000);
      const usedZzin = true;

      const oHash = originalHash || (originalImage ? await hashImage(originalImage) : await hashImage(finalImage));
      const cHash = certifiedHash || (certifiedImage ? await hashImage(certifiedImage) : oHash);
      debugGroup('registerOnChain: hashes', { originalHash: oHash, certifiedHash: cHash });

      // World ID proof tied to the ORIGINAL hash
      const verifyRes = await MiniKit.commandsAsync.verify({
        action: WORLD_ID_ACTION, signal: oHash, verification_level: VerificationLevel.Orb,
      });
      const proofPayload = verifyRes?.finalPayload;
      if (proofPayload?.status !== 'success') throw new Error('World ID 인증에 실패했습니다.');

      const decodedProof = decodeAbiParameters(
        [{ type: 'uint256[8]' }], proofPayload.proof as `0x${string}`,
      )[0] as readonly bigint[];
      const merkleRoot = BigInt(proofPayload.merkle_root);
      const nullifierHash = BigInt(proofPayload.nullifier_hash);

      setProcessingMessage('SUBMITTING TX...');

      // Check if already registered → linkCertificate only
      const isAlreadyRegistered = (await fileRegistryPublicClient.readContract({
        address: FILE_REGISTRY_CONTRACT_ADDRESS,
        abi: [{ type: 'function', name: 'isFileRegistered', stateMutability: 'view', inputs: [{ name: '_fileHash', type: 'bytes32' }], outputs: [{ name: '', type: 'bool' }] }],
        functionName: 'isFileRegistered',
        args: [oHash as `0x${string}`],
      })) as boolean;

      const functionName = isAlreadyRegistered ? ('linkCertificate' as const) : ('registerFileWithCertificate' as const);
      debugGroup('sendTransaction', { functionName, isAlreadyRegistered });

      if (isAlreadyRegistered) setProcessingMessage('LINKING CERTIFICATE...');

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: FILE_REGISTRY_CONTRACT_ADDRESS,
          abi: FileRegistryWriteABI,
          functionName,
          args: isAlreadyRegistered
            ? ([oHash, cHash] as const)
            : ([oHash, cHash, worldid, BigInt(timestamp), usedZzin, merkleRoot, nullifierHash, decodedProof] as const),
        }],
      });
      debugGroup('sendTransaction: result', finalPayload);
      if (finalPayload.status !== 'success') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorCode = (finalPayload as any)?.error_code || 'unknown_error';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const debugUrl = (finalPayload as any)?.debug_url as string | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const details = (finalPayload as any)?.details as Record<string, unknown> | undefined;
        const simulationError = typeof details?.simulationError === 'string' ? details.simulationError : typeof details?.reason === 'string' ? details.reason : undefined;
        const hint = errorCode === 'input_error' ? ' (ABI/args 문제일 수 있음)' : errorCode === 'invalid_contract' ? ' (Dev Portal allowlist 필요)' : '';
        throw new Error(`sendTransaction 실패: ${errorCode}${hint}${simulationError ? ` sim=${simulationError}` : ''}${debugUrl ? ` debug=${debugUrl}` : ''}`);
      }

      setChainRegistration({
        originalHash: oHash, certifiedHash: cHash, verifiedWalletAddress: addr,
        worldid, timestamp, usedZzin, transactionId: finalPayload.transaction_id, network: 'worldchain',
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

  // --- 5. 저장/공유 ---
  const handleShareOriginal = async () => {
    const src = originalImage || tempImage;
    if (!src) return;
    try {
      const oHash = originalHash || (await hashImage(src));
      await shareDataUrl(src, `ZZIN_ORIGINAL_${oHash}.jpg`);
    } catch (err) {
      console.error('Share original failed', err);
      alert('공유/저장에 실패했습니다.');
    }
  };

  const handleShareCertificate = async () => {
    const src = certifiedImage || finalImage;
    if (!src) return;
    try {
      const oHash = originalHash || (originalImage ? await hashImage(originalImage) : await hashImage(finalImage!));
      const cHash = certifiedHash || (certifiedImage ? await hashImage(certifiedImage) : await hashImage(src));
      await shareDataUrl(src, `ZZIN_CERTIFICATE_ORIG_${oHash}_CERT_${cHash}.jpg`);
    } catch (err) {
      console.error('Share certificate failed', err);
      alert('공유/저장에 실패했습니다.');
    }
  };

  // --- 워터마크 바 SVG 생성 ---
  const generateWatermarkSvg = (direction: 'bottom' | 'side', datetime: string): string => {
    const logoGroup = `<g clip-path="url(#logoClip)"><g transform="translate(16, 11) scale(0.04802)"><rect x="0" y="0" width="708" height="712" fill="#0B090A"/><rect x="4" y="4" width="700" height="700" rx="80" fill="#0B090A"/><rect x="4" y="73" width="700" height="119" fill="#838383"/><rect x="4" y="4" width="700" height="174" rx="68" fill="#838383"/><circle cx="354" cy="350" r="237" fill="#0B0909"/><path d="M444.423 350L399.212 428.308L308.789 428.308L263.577 350L308.789 271.691L399.212 271.691L444.423 350Z" fill="#E3E3E3" stroke="#E3E3E3"/><path d="M417.315 349.539L385.927 403.904L323.153 403.904L291.766 349.539L323.153 295.175L385.928 295.175L417.315 349.539Z" fill="#E3E3E3" stroke="#E3E3E3"/><line x1="399" y1="286.1" x2="123" y2="286.1" stroke="#E3E3E3" stroke-width="30"/><line x1="432.51" y1="356.5" x2="287.01" y2="104.5" stroke="url(#lg0)" stroke-width="30"/><line x1="388.17" y1="416.229" x2="537.17" y2="170.229" stroke="#E3E3E3" stroke-width="30"/><line x1="164.128" y1="541.298" x2="313.129" y2="292.298" stroke="#E3E3E3" stroke-width="30"/><line x1="366" y1="186" x2="530" y2="186" stroke="#E3E3E3" stroke-width="30"/><line x1="177" y1="515" x2="376" y2="515" stroke="#E3E3E3" stroke-width="30"/><line x1="605" y1="413.8" x2="355" y2="413.8" stroke="#E3E3E3" stroke-width="30"/><line x1="414.99" y1="584.466" x2="278.99" y2="347.466" stroke="url(#lg1)" stroke-width="30"/><line x1="429.593" y1="283.914" x2="342.037" y2="133.548" stroke="#0B0909" stroke-width="30"/><path d="M380.627 585.132L295.5 436" stroke="#0B0909" stroke-width="30"/><path d="M631 350C631 502.983 506.983 627 354 627C201.017 627 77 502.983 77 350C77 197.017 201.017 73 354 73C506.983 73 631 197.017 631 350ZM118.55 350C118.55 480.035 223.965 585.45 354 585.45C484.035 585.45 589.45 480.035 589.45 350C589.45 219.965 484.035 114.55 354 114.55C223.965 114.55 118.55 219.965 118.55 350Z" fill="#57595B"/><path d="M631 350C631 502.983 506.983 627 354 627C201.017 627 77 502.983 77 350C77 197.017 201.017 73 354 73C506.983 73 631 197.017 631 350ZM82.54 350C82.54 499.923 204.077 621.46 354 621.46C503.923 621.46 625.46 499.923 625.46 350C625.46 200.077 503.923 78.54 354 78.54C204.077 78.54 82.54 200.077 82.54 350Z" fill="#D5D5D5"/><path d="M593 350.5C593 481.668 486.668 588 355.5 588C224.332 588 118 481.668 118 350.5C118 219.332 224.332 113 355.5 113C486.668 113 593 219.332 593 350.5ZM123.938 350.5C123.938 478.388 227.612 582.062 355.5 582.062C483.388 582.062 587.062 478.388 587.062 350.5C587.062 222.612 483.388 118.938 355.5 118.938C227.612 118.938 123.938 222.612 123.938 350.5Z" fill="#D5D5D5"/><path d="M155.418 182.108L154.645 178.021L144.048 190.676L140.409 187.628L157.665 167.023L162.601 191.218L163.455 195.51L174.537 182.276L178.176 185.323L160.604 206.306L155.418 182.108ZM187.534 150.225L187.476 146.066L174.857 156.705L171.797 153.077L192.346 135.753L193.039 160.437L193.14 164.811L206.338 153.685L209.397 157.314L188.472 174.955L187.534 150.225ZM208.195 124.619L212.933 121.62L227.63 144.833L222.892 147.832L208.195 124.619ZM233.215 110.537L238.314 108.29L257.597 109.591L253.982 101.387L259.081 99.1401L270.159 124.282L265.06 126.529L259.978 114.996L240.717 113.743L249.393 133.433L244.293 135.679L233.215 110.537Z" fill="#F3E8DF"/><path d="M289.805 112.387C290.264 113.92 290.083 115.544 289.261 117.26C288.421 118.915 287.265 119.963 285.794 120.404C284.077 120.919 282.376 120.928 280.691 120.431C278.987 119.873 277.914 118.858 277.473 117.387C276.775 115.057 276.689 113.212 277.217 111.851C277.805 110.472 278.989 109.516 280.766 108.983C282.851 108.358 284.754 108.355 286.477 108.975C288.181 109.533 289.29 110.67 289.805 112.387Z" fill="#CB0003"/><circle cx="630.5" cy="73.5" r="30.5" fill="#AC1717"/></g></g>`;
    const worldcoinIcon = `<g transform="translate(710, 8) scale(0.0667)" fill="none"><g transform="translate(-99.69,-99.95)"><g transform="matrix(1.2367,0,0,1.2367,-668.3,-668.51)"><g transform="matrix(1.2995,0,0,1.2995,725.31,727.89)"><g transform="translate(131.18,104.74)"><path stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" stroke="#222222" stroke-width="35px" d="m 119.067,-87.47 c 0,0 -145.507,0.23 -145.507,0.23 C -74.62,-87.24 -113.68,-48.18 -113.68,0 c 0,48.18 39.06,87.24 87.24,87.24 0,0 140.12,0 140.12,0"/></g></g><g transform="matrix(1.2995,0,0,1.2995,643.74,841.26)"><path stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" stroke="#222222" stroke-width="35px" d="m 2.309,17.5 c 0,0 336.111,0 336.111,0"/></g><g transform="matrix(1.2995,0,0,1.2995,621,621.38)"><g transform="translate(186.71,186.71)"><path stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" stroke="#222222" stroke-width="35px" d="M 0,-169.21 C 93.452,-169.21 169.21,-93.452 169.21,0 169.21,93.452 93.452,169.21 0,169.21 -93.452,169.21 -169.21,93.452 -169.21,0 -169.21,-93.452 -93.452,-169.21 0,-169.21 Z"/></g></g></g></g></g>`;

    if (direction === 'bottom') {
      return `<svg width="924" height="56" viewBox="0 0 924 56" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="logoClip"><rect x="16" y="11" width="34" height="34" rx="7"/></clipPath><linearGradient id="lg0" x1="300.433" y1="96.75" x2="445.933" y2="348.75" gradientUnits="userSpaceOnUse"><stop stop-color="#7D7D7D"/><stop offset="0.620192" stop-color="#E3E3E3"/></linearGradient><linearGradient id="lg1" x1="292.434" y1="339.751" x2="428.434" y2="576.751" gradientUnits="userSpaceOnUse"><stop offset="0.600961" stop-color="#E3E3E3"/><stop offset="1" stop-color="#7D7D7D"/></linearGradient></defs><rect width="924" height="56" fill="#FFFFFF"/><line x1="0" y1="0.5" x2="924" y2="0.5" stroke="#E8E8E8" stroke-width="1"/>${logoGroup}<text x="58" y="33" font-family="'Helvetica Neue', Arial, sans-serif" font-size="18" font-weight="800" fill="#222222" letter-spacing="0.3">ZZIN</text><text x="108" y="33" font-family="'Helvetica Neue', Arial, sans-serif" font-size="12" font-weight="400" fill="#AAAAAA" letter-spacing="0.2">by WorldID</text>${worldcoinIcon}<line x1="757" y1="14" x2="757" y2="42" stroke="#CCCCCC" stroke-width="1"/><text x="768" y="27" font-family="'Helvetica Neue', Arial, sans-serif" font-size="13" font-weight="700" fill="#222222" letter-spacing="0.2">This is Humanity. ZZIN</text><text x="768" y="43" font-family="'Helvetica Neue', Arial, sans-serif" font-size="11" font-weight="400" fill="#999999" letter-spacing="0.3">${datetime}</text></svg>`;
    }

    // === Side bar (56x924 vertical) ===
    const logoGroupV = `<g clip-path="url(#logoClipV)"><g transform="translate(11, 16) scale(0.04802)"><rect x="-18.93" y="9.47" width="708" height="712" fill="#0B090A"/><rect x="-14.93" y="13.47" width="700" height="700" rx="80" fill="#0B090A"/><rect x="-14.93" y="82.47" width="700" height="119" fill="#838383"/><rect x="-14.93" y="13.47" width="700" height="174" rx="68" fill="#838383"/><circle cx="335.07" cy="359.47" r="237" fill="#0B0909"/><path d="M425.49 359.47l-45.21 78.31-90.42 0-45.21-78.31 45.21-78.31 90.42 0z" fill="#E3E3E3" stroke="#E3E3E3"/><path d="M398.38 359l-31.39 54.37-62.77 0-31.39-54.37 31.39-54.36 62.78 0z" fill="#E3E3E3" stroke="#E3E3E3"/><line x1="380.07" y1="295.57" x2="104.07" y2="295.57" stroke="#E3E3E3" stroke-width="30"/><line x1="413.58" y1="365.97" x2="268.08" y2="113.97" stroke="url(#lg0v)" stroke-width="30"/><line x1="369.24" y1="425.69" x2="518.24" y2="179.69" stroke="#E3E3E3" stroke-width="30"/><line x1="145.2" y1="550.76" x2="294.2" y2="301.76" stroke="#E3E3E3" stroke-width="30"/><line x1="347.07" y1="195.47" x2="511.07" y2="195.47" stroke="#E3E3E3" stroke-width="30"/><line x1="158.07" y1="524.47" x2="357.07" y2="524.47" stroke="#E3E3E3" stroke-width="30"/><line x1="586.07" y1="423.27" x2="336.07" y2="423.27" stroke="#E3E3E3" stroke-width="30"/><line x1="396.06" y1="593.93" x2="260.06" y2="356.93" stroke="url(#lg1v)" stroke-width="30"/><line x1="410.66" y1="293.38" x2="323.11" y2="143.01" stroke="#0B0909" stroke-width="30"/><path d="M361.7 594.6l-85.13-149.13" stroke="#0B0909" stroke-width="30"/><path d="M612.07 359.47c0 152.98-124.02 277-277 277s-277-124.02-277-277 124.02-277 277-277 277 124.02 277 277zm-512.45 0c0 130.04 105.42 235.45 235.45 235.45s235.45-105.41 235.45-235.45-105.42-235.45-235.45-235.45-235.45 105.41-235.45 235.45z" fill="#57595B"/><path d="M612.07 359.47c0 152.98-124.02 277-277 277s-277-124.02-277-277 124.02-277 277-277 277 124.02 277 277zm-548.46 0c0 149.92 121.54 271.46 271.46 271.46s271.46-121.54 271.46-271.46-121.54-271.46-271.46-271.46-271.46 121.54-271.46 271.46z" fill="#D5D5D5"/><path d="M574.07 359.97c0 131.17-106.33 237.5-237.5 237.5s-237.5-106.33-237.5-237.5 106.33-237.5 237.5-237.5 237.5 106.33 237.5 237.5zm-469.06 0c0 127.89 103.67 231.56 231.56 231.56s231.56-103.67 231.56-231.56-103.67-231.56-231.56-231.56-231.56 103.67-231.56 231.56z" fill="#D5D5D5"/><path d="M136.49 191.57l-.77-4.09-10.6 12.66-3.64-3.05 17.26-20.6 4.94 24.19.85 4.29 11.08-13.23 3.64 3.05-17.57 20.98-5.19-24.2zm32.12-31.88l-.06-4.16-12.62 10.64-3.06-3.63 20.55-17.32.69 24.68.1 4.37 13.2-11.13 3.06 3.63-20.93 17.64-.94-24.73zm20.66-25.61l4.74-3 14.7 23.21-4.74 3-14.7-23.21zm25.02-14.08l5.1-2.25 19.28 1.3-3.62-8.2 5.1-2.25 11.08 25.14-5.1 2.25-5.08-11.53-19.26-1.25 8.68 19.69-5.1 2.25-11.08-25.14z" fill="#F3E8DF"/><path d="M270.87 121.85c.46 1.53.28 3.16-.54 4.87-.84 1.66-2 2.7-3.47 3.14-1.72.52-3.42.52-5.1.03-1.7-.56-2.78-1.57-3.22-3.04-.7-2.33-.78-4.18-.26-5.54.59-1.38 1.77-2.34 3.55-2.87 2.09-.63 3.99-.63 5.71-.01 1.7.56 2.81 1.7 3.33 3.41z" fill="#CB0003"/><circle cx="611.57" cy="82.97" r="30.5" fill="#AC1717"/></g></g>`;
    const worldcoinIconV = `<g fill="none" transform="rotate(-90, 28, 884) translate(28, 700) scale(0.0667)"><g><g><g transform="matrix(1.2367,0,0,1.2367,-668.3,-668.51)"><g transform="matrix(1.2995,0,0,1.2995,725.31,727.89)"><g><path d="m1.54 1484.93c0 0-145.51 0.23-145.51 0.23-48.18 0-87.24 39.06-87.24 87.24s39.06 87.24 87.24 87.24c0 0 140.12 0 140.12 0" stroke-width="35px" stroke="#222222" stroke-miterlimit="10" stroke-linecap="round"/></g></g><g transform="matrix(1.2995,0,0,1.2995,643.74,841.26)"><path d="m-246.39 1485.16c0 0 336.11 0 336.11 0" stroke-width="35px" stroke="#222222" stroke-miterlimit="10" stroke-linecap="round"/></g><g transform="matrix(1.2995,0,0,1.2995,621,621.38)"><g><path d="m-62 1485.16c93.45 0 169.21 75.76 169.21 169.21s-75.76 169.21-169.21 169.21-169.21-75.76-169.21-169.21 75.76-169.21 169.21-169.21z" stroke-width="35px" stroke="#222222" stroke-miterlimit="10" stroke-linecap="round"/></g></g></g></g></g></g>`;
    return `<svg width="56" height="924" xmlns="http://www.w3.org/2000/svg" fill="none"><defs><clipPath id="logoClipV"><rect rx="7" height="34" width="34" y="16" x="11"/></clipPath><linearGradient y2="0.969" x2="1.092" y1="-0.031" x1="0.092" id="lg0v"><stop stop-color="#7D7D7D"/><stop stop-color="#E3E3E3" offset="0.62"/></linearGradient><linearGradient y2="0.967" x2="1.099" y1="-0.033" x1="0.099" id="lg1v"><stop stop-color="#E3E3E3" offset="0.601"/><stop stop-color="#7D7D7D" offset="1"/></linearGradient></defs><rect width="56" height="924" fill="#FFFFFF"/><line stroke="#E8E8E8" y2="924" x2="55.5" y1="0" x1="55.5"/>${logoGroupV}<g transform="rotate(90, 20, 65)"><text transform="rotate(-90, 25, 82)" letter-spacing="0.3" fill="#222222" font-weight="800" font-size="14" font-family="'Helvetica Neue', Arial, sans-serif" y="82" x="25">ZZIN</text></g><g transform="rotate(90, 28, 81)"><text transform="rotate(-90, 32, 106)" letter-spacing="0.2" fill="#AAAAAA" font-weight="400" font-size="10" font-family="'Helvetica Neue', Arial, sans-serif" y="106" x="32">by WorldID</text></g>${worldcoinIconV}<line stroke="#CCCCCC" y2="849" x2="46" y1="849" x1="10"/><g><text transform="rotate(-90, 26, 836)" letter-spacing="0.2" fill="#222222" font-weight="700" font-size="11" font-family="'Helvetica Neue', Arial, sans-serif" y="836" x="26">This is Humanity. ZZIN</text></g><g><text transform="rotate(-90, 39, 836)" letter-spacing="0.3" fill="#999999" font-weight="400" font-size="9" font-family="'Helvetica Neue', Arial, sans-serif" y="836" x="39">${datetime}</text></g></svg>`;
  };

  // --- 6. 검증 (온체인 매핑 확인) ---
  const verifyOnChainByHash = async (fileHash: string) => {
    debugGroup('verifyOnChainByHash: request', { fileHash });
    const response = await fetch('/api/verify-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileHash }),
    });
    const data = await response.json();
    debugGroup('verifyOnChainByHash: response', { ok: response.ok, data });
    if (!response.ok || !data?.success) throw new Error(data?.error || '온체인 검증 실패');

    const normalized = {
      registered: Boolean(data.registered),
      inputHash: data.inputHash || fileHash,
      resolvedOriginalHash: typeof data.resolvedOriginalHash === 'string' ? data.resolvedOriginalHash : null,
      isCertified: typeof data.isCertified === 'boolean' ? data.isCertified : null,
      location: data.location || undefined,
      worldid: data.worldid || undefined,
      timestamp: typeof data.timestamp === 'string' ? Number(data.timestamp) : data.timestamp,
      usedZzin: typeof data.usedZzin === 'boolean' ? data.usedZzin : undefined,
      owner: data.owner || null,
    } as const;
    setVerifiedData(normalized);
    return normalized;
  };

  const normalizeHashCandidate = (raw: string) => {
    const text = raw.trim();
    if (!text) return '';
    const full = text.match(/0x[a-fA-F0-9]{64}/)?.[0];
    if (full) return full;
    const bare = text.match(/\b[a-fA-F0-9]{64}\b/)?.[0];
    if (bare) return `0x${bare}`;
    return text;
  };

  const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      debugGroup('verify: selected file', { name: file.name, type: file.type, size: file.size });
      const url = URL.createObjectURL(file);
      setFinalImage(url);
      setVerifyError(null);
      setVerifyHint(null);
      setVerifiedData(null);
      setMode('verify_result');

      setIsScanning(true);
      try {
        const fileHash = keccak256(toHex(new Uint8Array(await file.arrayBuffer())));
        debugGroup('verify: computed fileHash', { fileHash });
        const res = await verifyOnChainByHash(fileHash);

        // iOS 사진앱 재인코딩 대응: 파일명에서 해시 추출 시도
        if (!res.registered) {
          const fromName = normalizeHashCandidate(file.name);
          if (fromName && fromName !== fileHash && /^0x[a-fA-F0-9]{64}$/.test(fromName)) {
            debugGroup('verify: fallback hash from filename', { fromName });
            const res2 = await verifyOnChainByHash(fromName);
            if (res2.registered) {
              setVerifyHint('파일명에서 해시를 추출해 검증했습니다. (iOS 사진앱은 이미지가 재인코딩될 수 있어요)');
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '온체인 검증 실패';
        setVerifyError(message);
      } finally {
        setIsScanning(false);
      }
  };

  const handleManualVerify = async () => {
    const hash = manualVerifyHash.trim();
    if (!hash) return;
    debugGroup('manual verify: input', { hash });
    setVerifyError(null);
    setVerifyHint(null);
    setVerifiedData(null);
    setFinalImage(null);
    setMode('verify_result');
    setIsScanning(true);
    try {
      await verifyOnChainByHash(hash);
    } catch (err) {
      const message = err instanceof Error ? err.message : '온체인 검증 실패';
      setVerifyError(message);
    } finally {
      setIsScanning(false);
    }
  };

  const pasteManualVerifyHash = async () => {
    setManualVerifyHint(null);
    try {
      if (!navigator?.clipboard?.readText) throw new Error('clipboard_api_unavailable');
      const text = await navigator.clipboard.readText();
      const normalized = normalizeHashCandidate(text);
      if (!normalized) { setManualVerifyHint('클립보드가 비어있습니다.'); return; }
      setManualVerifyHash(normalized);
      manualVerifyInputRef.current?.focus();
      setManualVerifyHint('클립보드에서 해시를 붙여넣었습니다.');
    } catch (err) {
      debugGroup('pasteManualVerifyHash: failed', err);
      setManualVerifyHint('클립보드 접근이 차단되었습니다. 입력칸을 길게 눌러 직접 붙여넣기 하세요.');
    }
  };

  const resetCaptureState = () => {
    setTempImage(null);
    setFinalImage(null);
    setOriginalImage(null);
    setCertifiedImage(null);
    setOriginalHash(null);
    setCertifiedHash(null);
    setCapturedWorldid(null);
    setChainRegistration(null);
    setChainRegistrationError(null);
    setTransactionId('');
    setCapturedTimestamp(null);
    setVerifyHint(null);
    setBarCertImage(null);
    setVerticalCertImage(null);
    setBarCertHash(null);
    setVerticalCertHash(null);
  };

  const goBack = () => {
    setMode('menu');
    resetCaptureState();
    setVerifiedData(null);
    setVerifyError(null);
    setManualVerifyHash('');
    setManualVerifyHint(null);
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

  // =====================
  // === 렌더링 (Leica) ===
  // =====================

  // Helper: Material icon
  const Icon = ({ name, className = '' }: { name: string; className?: string }) => (
    <span className={`material-symbols-outlined ${className}`}>{name}</span>
  );

  // 1. 로그인 (Auth Screen)
  if (mode === 'login') return (
    <div className="flex flex-col h-[100dvh] bg-[#111] items-center justify-center p-8 text-center animate-fade-in">
      {/* ZZIN Logo */}
      <div className="mb-8">
        <img src="/zzin-logo.svg" alt="ZZIN" width={100} height={100} />
      </div>

      <h1 className="text-5xl font-black tracking-tight text-white mb-1" style={{ fontFamily: 'var(--font-inter)' }}>
        ZZIN
      </h1>
      <p className="font-cam text-xs text-zinc-500 tracking-[0.3em] uppercase mb-12">
        This is Humanity.
      </p>

      <div className="w-full max-w-xs space-y-4">
        <button
          onClick={verifyHumanity}
          disabled={isLoading}
          className={`w-full py-4 px-6 text-base font-bold rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 ${
            isHumanVerified
              ? 'bg-emerald-500 text-white'
              : 'bg-white text-black shadow-[0_0_30px_rgba(255,255,255,0.1)]'
          }`}
        >
          <Icon name="fingerprint" className="text-xl" />
          {isLoading ? 'Verifying...' : isHumanVerified ? 'Orb Verified' : 'Connect World ID'}
        </button>

        {humanVerifyStatus && (
          <p className="font-cam text-xs text-zinc-500">{humanVerifyStatus}</p>
        )}
      </div>

      <p className="absolute bottom-8 font-cam text-[10px] text-zinc-600 tracking-widest">
        Powered by World Chain
      </p>
    </div>
  );

  // 2. 메뉴 (Main Hub)
  if (mode === 'menu') return (
    <div className="flex flex-col h-[100dvh] bg-[#111] animate-fade-in">
      {/* Header - compact */}
      <div className="shrink-0 px-5 pt-14 pb-2 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <img src="/zzin-logo.svg" alt="ZZIN" width={30} height={30} className="rounded-lg" />
          <span className="text-xl font-black tracking-tight text-white">ZZIN</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-cam ${
          isHumanVerified
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
            : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
        }`}>
          <Icon name="verified_user" className="text-xs" />
          {isHumanVerified ? 'Verified' : 'Guest'}
        </div>
      </div>

      {walletStatus && (
        <p className="text-[10px] text-zinc-500 px-5 font-cam">{walletStatus}</p>
      )}

      {/* Main Actions */}
      <div className="flex-1 flex flex-col justify-center px-5 gap-4">
        <button
          onClick={async () => {
            try {
              await ensureWalletConnected();
              resetCaptureState();
              setMode('camera');
            } catch (err) {
              const message = err instanceof Error ? err.message : '지갑 연결 실패';
              alert(message);
            }
          }}
          className="relative w-full rounded-3xl px-6 py-8 flex items-center gap-5 active:scale-[0.97] transition-all bg-gradient-to-br from-[#1a1a1f] to-[#151518] border border-zinc-800/60 shadow-[0_2px_20px_rgba(0,0,0,0.3)]"
        >
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#D92027] to-[#b91c22] flex items-center justify-center shrink-0 shadow-[0_4px_16px_rgba(217,32,39,0.25)]">
            <Icon name="photo_camera" className="text-white text-2xl" />
          </div>
          <div className="text-left flex-1">
            <h2 className="text-[17px] font-bold text-white">Capture</h2>
            <p className="text-[13px] text-zinc-500 mt-1">Take photo & register on-chain</p>
          </div>
          <Icon name="chevron_right" className="text-zinc-600 text-xl" />
        </button>

        <button
          onClick={() => setMode('verify')}
          className="relative w-full rounded-3xl px-6 py-8 flex items-center gap-5 active:scale-[0.97] transition-all bg-gradient-to-br from-[#1a1a1f] to-[#151518] border border-zinc-800/60 shadow-[0_2px_20px_rgba(0,0,0,0.3)]"
        >
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-zinc-600 to-zinc-700 flex items-center justify-center shrink-0 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <Icon name="travel_explore" className="text-white text-2xl" />
          </div>
          <div className="text-left flex-1">
            <h2 className="text-[17px] font-bold text-white">Verify</h2>
            <p className="text-[13px] text-zinc-500 mt-1">Check on-chain proof</p>
          </div>
          <Icon name="chevron_right" className="text-zinc-600 text-xl" />
        </button>
      </div>

      <p className="text-center font-cam text-[10px] text-zinc-600 tracking-widest pb-8">
        ZZIN × WORLD CHAIN
      </p>
    </div>
  );

  // 3. 카메라 / 프리뷰 / 인증서 선택 / 등록 프롬프트 / 결과
  if (['camera', 'preview', 'cert_select', 'register_prompt', 'result'].includes(mode)) return (
    <div className="flex flex-col h-[100dvh] bg-[#111]">

      {/* Top Bar */}
      <div className="bg-metal shrink-0 px-4 py-3 flex items-center justify-between z-30 border-b border-zinc-800/50">
        <button onClick={goBack} className="flex items-center gap-1 text-zinc-400 active:text-white transition-colors">
          <Icon name="arrow_back" className="text-lg" />
          <span className="text-xs font-bold">MENU</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="font-cam text-[10px] text-zinc-500 tracking-wider">WLD-MAIN</span>
          <Icon name="wifi" className="text-emerald-400 text-sm" />
        </div>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center mx-3 my-2 rounded-2xl border border-zinc-800/50">

        {/* HUD Overlays - camera/preview only */}
        {(mode === 'camera' || mode === 'preview') && (
          <>
            <div className="absolute top-0 left-0 right-0 z-10 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#D92027] animate-pulse"></span>
                <span className="font-cam text-[10px] text-white/70 tracking-wider">RAW</span>
              </div>
              <span className="font-cam text-[10px] text-white/50">ISO 200</span>
            </div>

            {mode === 'camera' && (
              <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                <div className="relative w-16 h-16">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-4 bg-white/30"></div>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-px h-4 bg-white/30"></div>
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-px bg-white/30"></div>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-px bg-white/30"></div>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-white/40"></div>
                </div>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 z-10 p-3">
              <div className="flex items-center justify-between">
                <span className="font-cam text-[9px] text-white/40 truncate max-w-[120px]">ZZIN_PROOF.jpg</span>
                <span className="font-cam text-[9px] text-white/40 truncate max-w-[140px]">
                  {capturedTimestamp ? `#${capturedTimestamp.toString(16).toUpperCase().slice(0, 8)}` : '#--------'}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Content */}
        {mode === 'camera' && (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        )}
        {mode === 'preview' && tempImage && (
          <img src={tempImage} className="w-full h-full object-contain animate-focus" alt="Preview" />
        )}
        {mode === 'cert_select' && originalImage && (
          <img src={originalImage} className="w-full h-full object-contain" alt="Original" />
        )}
        {mode === 'register_prompt' && finalImage && (
          <img src={finalImage} className="w-full h-full object-contain" alt="Captured" />
        )}
        {mode === 'result' && finalImage && (
          <img src={finalImage} className="w-full h-full object-contain" alt="Result" />
        )}
      </div>

      {/* Bottom Controls */}
      <div className="shrink-0 px-4 pb-6 pt-3 z-30">

        {/* Camera mode controls */}
        {mode === 'camera' && (
          <div className="flex items-center justify-between px-4">
            {/* ZZIN Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#D92027]"></span>
              <span className="font-cam text-[10px] text-zinc-400 tracking-wider">ZZIN</span>
            </div>

            {/* Shutter */}
            <button onClick={capturePhoto} className="shutter-btn">
              <Icon name="fingerprint" className="text-white text-2xl relative z-10" />
            </button>

            {/* Flip Camera */}
            <button
              onClick={() => setFacingMode(p => p === 'user' ? 'environment' : 'user')}
              className="w-11 h-11 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center active:scale-90 transition-transform"
            >
              <Icon name="flip_camera_ios" className="text-zinc-400 text-lg" />
            </button>
          </div>
        )}

        {/* Preview controls */}
        {mode === 'preview' && (
          <div className="flex gap-3 w-full">
            <button
              onClick={() => { resetCaptureState(); setMode('camera'); }}
              className="flex-1 py-3.5 bg-zinc-800 text-zinc-300 font-bold rounded-xl text-sm border border-zinc-700 active:scale-95 transition-transform"
            >
              다시 찍기
            </button>
            <button
              onClick={confirmCapture}
              className="flex-1 py-3.5 bg-white text-black font-black rounded-xl text-sm active:scale-95 transition-transform"
            >
              다음
            </button>
          </div>
        )}

        {/* Certificate format selection */}
        {mode === 'cert_select' && (
          <div className="space-y-3 w-full animate-fade-in">
            <p className="text-center text-[13px] font-semibold text-white">인증서 형식을 선택하세요</p>
            <div className="flex gap-3">
              {/* Bar (가로) */}
              <button
                onClick={() => selectCertificate('bar')}
                className="flex-1 rounded-2xl overflow-hidden border border-zinc-700 bg-[#1c1c1e] active:scale-[0.97] transition-all"
              >
                {barCertImage && (
                  <div className="p-2 bg-black">
                    <img src={barCertImage} className="w-full object-contain max-h-36 rounded-lg" alt="Bar" />
                  </div>
                )}
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[13px] font-semibold text-white">Bar</p>
                  <p className="text-[11px] text-zinc-500">하단 워터마크</p>
                </div>
              </button>
              {/* Vertical (세로) */}
              <button
                onClick={() => selectCertificate('vertical')}
                className="flex-1 rounded-2xl overflow-hidden border border-zinc-700 bg-[#1c1c1e] active:scale-[0.97] transition-all"
              >
                {verticalCertImage && (
                  <div className="p-2 bg-black">
                    <img src={verticalCertImage} className="w-full object-contain max-h-36 rounded-lg" alt="Vertical" />
                  </div>
                )}
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[13px] font-semibold text-white">Vertical</p>
                  <p className="text-[11px] text-zinc-500">사이드 워터마크</p>
                </div>
              </button>
            </div>
            <button
              onClick={() => { resetCaptureState(); setMode('camera'); }}
              className="w-full py-3 bg-zinc-800 text-zinc-400 font-semibold rounded-xl text-[13px] border border-zinc-700 active:scale-95 transition-transform"
            >
              다시 찍기
            </button>
          </div>
        )}

        {/* Register prompt controls */}
        {mode === 'register_prompt' && (
          <div className="glass-panel p-5 space-y-4">
            <p className="text-center text-sm font-bold text-white">온체인에 해시를 등록할까요?</p>
            {chainRegistrationError && (
              <p className="text-center text-xs text-[#D92027]">{chainRegistrationError}</p>
            )}
            <div className="flex gap-3 w-full">
              <button
                onClick={skipOnChain}
                className="flex-1 py-3.5 bg-zinc-800 text-zinc-300 font-bold rounded-xl text-sm border border-zinc-700 active:scale-95 transition-transform"
              >
                건너뛰기
              </button>
              <button
                onClick={registerOnChain}
                className="flex-1 py-3.5 bg-[#D92027] text-white font-black rounded-xl text-sm active:scale-95 transition-transform shadow-[0_4px_20px_rgba(217,32,39,0.3)]"
              >
                온체인 등록
              </button>
            </div>
          </div>
        )}

        {/* Result controls */}
        {mode === 'result' && (
          <div className="space-y-3">
            {chainRegistrationError && (
              <p className="text-center text-xs text-[#D92027]">{chainRegistrationError}</p>
            )}

            <div className="glass-panel p-4 space-y-2">
              {chainRegistration?.transactionHash ? (
                <div className="space-y-2 font-cam text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">NETWORK</span>
                    <span className="text-white">{chainRegistration.network || 'worldchain'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">WALLET</span>
                    <span className="text-white truncate max-w-[160px]">{chainRegistration.verifiedWalletAddress}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">WORLD ID</span>
                    <span className="text-white">{chainRegistration.worldid}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">TIMESTAMP</span>
                    <span className="text-white">{chainRegistration.timestamp ? new Date(chainRegistration.timestamp * 1000).toLocaleString() : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ZZIN USED</span>
                    <span className="text-[#D92027]">{String(chainRegistration.usedZzin)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ORIGINAL</span>
                    <span className="text-white truncate max-w-[140px]">{chainRegistration.originalHash}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">CERTIFICATE</span>
                    <span className="text-white truncate max-w-[140px]">{chainRegistration.certifiedHash}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">TX HASH</span>
                    <span className="text-white truncate max-w-[140px]">{chainRegistration.transactionHash}</span>
                  </div>
                  {chainRegistration.transactionUrl && (
                    <a
                      href={chainRegistration.transactionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-center text-[#D92027] font-bold tracking-wider mt-2 py-2 border border-[#D92027]/30 rounded-lg hover:bg-[#D92027]/10 transition-colors"
                    >
                      VIEW ON WORLDSCAN
                    </a>
                  )}
                </div>
              ) : chainRegistration?.transactionId ? (
                <div className="space-y-2 font-cam text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">NETWORK</span>
                    <span className="text-white">{chainRegistration.network || 'worldchain'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">WALLET</span>
                    <span className="text-white truncate max-w-[160px]">{chainRegistration.verifiedWalletAddress}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">WORLD ID</span>
                    <span className="text-white">{chainRegistration.worldid}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">TIMESTAMP</span>
                    <span className="text-white">{chainRegistration.timestamp ? new Date(chainRegistration.timestamp * 1000).toLocaleString() : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ZZIN USED</span>
                    <span className="text-[#D92027]">{String(chainRegistration.usedZzin)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">ORIGINAL</span>
                    <span className="text-white truncate max-w-[160px]">{chainRegistration.originalHash}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">CERTIFICATE</span>
                    <span className="text-white truncate max-w-[160px]">{chainRegistration.certifiedHash}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">TX ID</span>
                    <span className="text-white truncate max-w-[160px]">{chainRegistration.transactionId}</span>
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <div className="w-3 h-3 border-2 border-zinc-700 border-t-[#D92027] rounded-full animate-spin"></div>
                    <span className="text-[#D92027] tracking-wider">CONFIRMING TX...</span>
                  </div>
                </div>
              ) : (
                <p className="font-cam text-[11px] text-zinc-500 text-center py-2">온체인 등록을 건너뛴 이미지입니다.</p>
              )}
            </div>

            <div className="flex gap-2 w-full">
              <button
                onClick={() => {
                  resetCaptureState();
                  setMode('camera');
                }}
                className="flex-1 py-3.5 bg-zinc-800 text-zinc-400 font-bold rounded-xl text-sm border border-zinc-700 active:scale-95 transition-transform"
              >
                새 촬영
              </button>
              <button
                onClick={handleShareOriginal}
                className="flex-1 py-3.5 bg-zinc-700 text-white font-bold rounded-xl text-sm border border-zinc-600 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
              >
                <Icon name="image" className="text-sm" /> 원본
              </button>
              <button
                onClick={handleShareCertificate}
                className="flex-[1.5] py-3.5 bg-[#D92027] text-white font-black rounded-xl text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-[0_4px_20px_rgba(217,32,39,0.3)]"
              >
                <Icon name="verified" className="text-sm" /> 인증서 저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
          <div className="w-10 h-10 border-4 border-zinc-800 border-t-[#D92027] rounded-full animate-spin mb-4"></div>
          <p className="font-cam text-white font-bold text-xs tracking-[0.3em]">{processingMessage}</p>
        </div>
      )}
    </div>
  );

  // 4. 검증 파일 선택 (Verify Mode)
  if (mode === 'verify') return (
    <div className="flex flex-col h-[100dvh] bg-[#111] text-white animate-fade-in">
      {/* Header */}
      <div className="shrink-0 px-5 pt-14 pb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Verify</h1>
        <button
          onClick={goBack}
          className="flex items-center gap-1 text-zinc-400 text-[13px] active:text-white transition-colors"
        >
          <Icon name="arrow_back" className="text-base" />
          <span>Back</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col px-5 gap-4 overflow-auto pb-8">
        {/* Upload Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="w-full bg-[#1c1c1e] border border-zinc-800 rounded-2xl py-10 cursor-pointer active:scale-[0.98] transition-all flex flex-col items-center text-center"
        >
          <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
            <Icon name="add_photo_alternate" className="text-2xl text-zinc-400" />
          </div>
          <p className="text-[15px] font-semibold text-white">Load Photo</p>
          <p className="text-[13px] text-zinc-500 mt-0.5">Tap to select from gallery</p>
          <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileLoad} className="hidden" />
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 px-2">
          <div className="flex-1 h-px bg-zinc-800"></div>
          <span className="text-[12px] text-zinc-500">or enter hash</span>
          <div className="flex-1 h-px bg-zinc-800"></div>
        </div>

        {/* Manual Hash Input */}
        <div className="w-full bg-[#1c1c1e] border border-zinc-800 rounded-2xl p-4 space-y-3">
          <input
            ref={manualVerifyInputRef}
            value={manualVerifyHash}
            onChange={(e) => setManualVerifyHash(e.target.value)}
            placeholder="0x..."
            className="w-full rounded-xl bg-black/50 border border-zinc-700 px-4 py-3 text-[13px] text-white outline-none focus:border-zinc-500 transition-colors placeholder:text-zinc-600"
            style={{ fontFamily: 'SF Mono, ui-monospace, monospace' }}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <div className="flex gap-2">
            <button
              onClick={pasteManualVerifyHash}
              className="flex-1 py-3 bg-zinc-800 text-zinc-300 font-semibold rounded-xl text-[13px] border border-zinc-700 active:scale-95 transition-transform"
            >
              Paste
            </button>
            <button
              onClick={handleManualVerify}
              disabled={!manualVerifyHash.trim()}
              className="flex-[2] py-3 bg-white text-black font-semibold rounded-xl text-[13px] active:scale-95 transition-transform disabled:opacity-30"
            >
              Verify Hash
            </button>
          </div>
          {manualVerifyHint && (
            <p className="text-[12px] text-zinc-400">{manualVerifyHint}</p>
          )}
        </div>

        {debugEnabled && (
          <p className="text-[11px] text-emerald-400">DEBUG ON</p>
        )}
      </div>
    </div>
  );

  // 5. 검증 결과 (Verify Result)
  if (mode === 'verify_result') return (
    <div className="flex flex-col h-[100dvh] bg-[#111]">
      {/* Header */}
      <div className="shrink-0 px-5 pt-14 pb-3 flex items-center justify-between">
        <button onClick={goBack} className="flex items-center gap-1 text-zinc-400 text-[13px] active:text-white transition-colors">
          <Icon name="arrow_back" className="text-base" />
          <span>Back</span>
        </button>
        <span className="text-[12px] text-zinc-500">Verification</span>
      </div>

      {/* Image Area with Scan */}
      {finalImage && (
        <div className="shrink-0 px-5 pb-3">
          <div className={`relative rounded-2xl overflow-hidden transition-all duration-700 ${
            !isScanning && verifiedData?.registered
              ? 'ring-2 ring-emerald-400/60'
              : !isScanning && (verifiedData && !verifiedData.registered || verifyError)
                ? 'ring-2 ring-[#D92027]/60'
                : 'ring-1 ring-zinc-800'
          }`}>
            <img src={finalImage} className="w-full max-h-[35vh] object-cover" alt="Verify" />
            {isScanning && (
              <div
                className="absolute left-0 right-0 h-0.5 bg-[#D92027] shadow-[0_0_15px_#D92027,0_0_30px_#D92027]"
                style={{ animation: 'scan 1.8s ease-in-out infinite' }}
              ></div>
            )}
          </div>
        </div>
      )}

      {/* Result Card */}
      <div className="flex-1 overflow-auto px-5 pb-8">
        {isScanning ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-[#D92027] rounded-full animate-spin"></div>
            <p className="text-[13px] text-zinc-400">Verifying on-chain...</p>
          </div>
        ) : (
          <div className="animate-fade-in space-y-4">
            {verifyError ? (
              <div className="bg-[#1c1c1e] border border-zinc-800 rounded-2xl p-5">
                <div className="text-center">
                  <Icon name="error" className="text-3xl text-[#D92027] mb-2" />
                  <h2 className="text-[17px] font-bold text-white mb-1">Verification Error</h2>
                  <p className="text-[13px] text-zinc-400">{verifyError}</p>
                </div>
              </div>
            ) : verifiedData?.registered ? (
              <div className="bg-[#1c1c1e] border border-zinc-800 rounded-2xl overflow-hidden">
                {/* Status Header */}
                <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Icon name="verified" className="text-xl text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold text-white">Created by Human</h2>
                    <p className="text-[12px] text-emerald-400">ZZIN Verified</p>
                  </div>
                </div>

                {verifyHint && (
                  <div className="px-5 py-2 border-b border-zinc-800">
                    <p className="text-[12px] text-zinc-400">{verifyHint}</p>
                  </div>
                )}

                {/* Data rows - Apple Settings style */}
                <div className="divide-y divide-zinc-800">
                  {typeof verifiedData.isCertified === 'boolean' && (
                    <div className="px-5 py-3 flex justify-between items-center">
                      <span className="text-[13px] text-zinc-400">Query Type</span>
                      <span className="text-[13px] text-white">{verifiedData.isCertified ? 'Certificate' : 'Original'}</span>
                    </div>
                  )}
                  {verifiedData.owner && (
                    <div className="px-5 py-3 flex justify-between items-center">
                      <span className="text-[13px] text-zinc-400">Owner</span>
                      <span className="text-[13px] text-white truncate max-w-[180px]" style={{ fontFamily: 'SF Mono, ui-monospace, monospace' }}>{verifiedData.owner}</span>
                    </div>
                  )}
                  {verifiedData.worldid && (
                    <div className="px-5 py-3 flex justify-between items-center">
                      <span className="text-[13px] text-zinc-400">World ID</span>
                      <span className="text-[13px] text-white">{verifiedData.worldid}</span>
                    </div>
                  )}
                  <div className="px-5 py-3 flex justify-between items-center">
                    <span className="text-[13px] text-zinc-400">Timestamp</span>
                    <span className="text-[13px] text-white">{verifiedData.timestamp ? new Date(verifiedData.timestamp * 1000).toLocaleString() : '-'}</span>
                  </div>
                  <div className="px-5 py-3 flex justify-between items-center">
                    <span className="text-[13px] text-zinc-400">ZZIN</span>
                    <span className="text-[13px] text-emerald-400">{verifiedData.usedZzin ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="px-5 py-3 flex justify-between items-center">
                    <span className="text-[13px] text-zinc-400 shrink-0 mr-3">Proof</span>
                    <span className="text-[12px] text-white truncate" style={{ fontFamily: 'SF Mono, ui-monospace, monospace' }}>{verifiedData.inputHash}</span>
                  </div>
                  {verifiedData.resolvedOriginalHash && verifiedData.resolvedOriginalHash !== verifiedData.inputHash && (
                    <div className="px-5 py-3 flex justify-between items-center">
                      <span className="text-[13px] text-zinc-400 shrink-0 mr-3">Original</span>
                      <span className="text-[12px] text-white truncate" style={{ fontFamily: 'SF Mono, ui-monospace, monospace' }}>{verifiedData.resolvedOriginalHash}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-[#1c1c1e] border border-zinc-800 rounded-2xl p-5">
                <div className="text-center">
                  <Icon name="search_off" className="text-3xl text-[#D92027] mb-2" />
                  <h2 className="text-[17px] font-bold text-white mb-1">Not Found</h2>
                  <p className="text-[13px] text-zinc-500">This image is not registered on-chain.</p>
                </div>
              </div>
            )}

            <button
              onClick={goBack}
              className="w-full py-3.5 bg-[#1c1c1e] text-white font-semibold rounded-2xl text-[15px] border border-zinc-800 active:scale-[0.98] transition-transform"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
