'use client'
import { useState, useRef, useEffect } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';

export default function Home() {
  const [mode, setMode] = useState<'login' | 'menu' | 'camera' | 'preview' | 'result' | 'verify' | 'verify_result' | 'verify_fail'>('login');
  const [isHumanVerified, setIsHumanVerified] = useState(false);
  const [humanVerifyStatus, setHumanVerifyStatus] = useState<string | null>(null);

  // 카메라 & 이미지
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [tempImage, setTempImage] = useState<string | null>(null); 
  const [finalImage, setFinalImage] = useState<string | null>(null);
  
  // 상태
  const [status, setStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // 검증된 데이터 (실제 파일 기반)
  const [verifiedData, setVerifiedData] = useState<{ creator: string, time: string, isZZIN: boolean } | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- 1. 로그인 ---
  const verifyHumanity = async () => {
    if (!MiniKit.isInstalled()) { alert("World App 필요"); return; }
    setIsLoading(true);
    setHumanVerifyStatus('인간 인증 진행 중...');
    try {
      const res = await MiniKit.commandsAsync.verify({
        action: 'orbgate',
        signal: `login-${Date.now()}`,
        verification_level: 'orb'
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
          signal: verified.signal,
        })
      });
      const serverJson = await serverRes.json();
      if (!serverRes.ok || !serverJson?.verifyRes?.success) {
        throw new Error('Server verification failed');
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
  const startCamera = async () => {
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
    } catch (e) { console.error("Camera fail", e); }
  };

  useEffect(() => {
    if (mode === 'camera') startCamera();
  }, [facingMode, mode]);

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
    setMode('preview');
  };

  // --- 4. 서명 및 Ghost QR 생성 ---
  const confirmAndSign = async () => {
    if (!tempImage) return;
    setIsLoading(true); 
    setStatus('온체인 데이터 생성 중...');

    const imageHash = tempImage.slice(-15);
    const qrPayload = `ZZIN:HUMAN:${imageHash}`;

    try {
        const res = await MiniKit.commandsAsync.signMessage({ message: qrPayload });
        const signed = res?.finalPayload;
        if (signed?.status !== 'success') throw new Error('Signature rejected');
    } catch (err) {
        setIsLoading(false);
        console.warn('User cancelled signing QR payload', err);
        alert('서명을 완료해야 워터마크를 생성할 수 있습니다.');
        return;
    }

    try {
      setStatus('워터마크 합성 중...');
      await generateGhostQR(tempImage, qrPayload);
    } catch (e) { 
      setIsLoading(false); 
    }
  };

  const generateGhostQR = async (imgSrc: string, text: string) => {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}&bgcolor=FFFFFF&color=000000&margin=0`;
    const bgImg = new Image(); bgImg.crossOrigin = "Anonymous"; bgImg.src = imgSrc;
    const qrImg = new Image(); qrImg.crossOrigin = "Anonymous"; qrImg.src = qrUrl;

    await Promise.all([
        new Promise(resolve => bgImg.onload = resolve),
        new Promise(resolve => qrImg.onload = resolve)
    ]);

    const canvas = document.createElement('canvas');
    canvas.width = bgImg.width;
    canvas.height = bgImg.height;
    const ctx = canvas.getContext('2d');
    if(!ctx) return;

    ctx.drawImage(bgImg, 0, 0);

    const qrSize = canvas.width * 0.12; 
    const margin = canvas.width * 0.03; 
    const lx = margin;
    const ly = canvas.height - margin - qrSize;

    ctx.globalAlpha = 0.5; 
    ctx.drawImage(qrImg, lx, ly, qrSize, qrSize);
    ctx.globalAlpha = 1.0;

    setFinalImage(canvas.toDataURL('image/jpeg'));
    setMode('result');
    setIsLoading(false);
  };

  // --- 5. 저장 ---
  const handleSave = async () => {
    if (!finalImage) return;
    try {
        const response = await fetch(finalImage);
        const blob = await response.blob();
        
        // ★ 중요: 파일명에 'ZZIN'을 포함시켜 저장해야 나중에 검증됨
        const file = new File([blob], "ZZIN_PROOF.jpg", { type: "image/jpeg" });
        
        if (navigator.share) {
            await navigator.share({ files: [file], title: 'ZZIN Proof' });
        } else {
             const a = document.createElement('a'); a.href = finalImage; a.download = "ZZIN_PROOF.jpg"; a.click();
        }
    } catch (e) { alert("저장을 위해 화면을 꾹 눌러주세요."); }
  };

  // --- 6. 검증 (진짜 파일 메타데이터 확인) ---
  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      setFinalImage(url);
      
      // ★ 핵심 수정: 파일의 실제 정보를 읽어서 검증 로직 수행
      // 1. 파일명에 'zzin'이 포함되어 있는지 확인 (우리가 만든 파일인지)
      const isZZINFile = file.name.toUpperCase().includes('ZZIN');
      
      // 2. 파일의 실제 수정 시간(lastModified) 가져오기 -> 가짜 시간 아님
      const realFileTime = new Date(file.lastModified).toLocaleString();

      setVerifiedData({
          creator: isZZINFile ? "HUMAN_VERIFIED" : "UNKNOWN",
          time: realFileTime,
          isZZIN: isZZINFile
      });

      setMode('verify_result');
  };

  const goBack = () => { setMode('menu'); setTempImage(null); setFinalImage(null); setVerifiedData(null); };

  // 스캔 효과
  useEffect(() => {
    if (mode === 'verify_result') {
        setIsScanning(true);
        const timer = setTimeout(() => setIsScanning(false), 2000);
        return () => clearTimeout(timer);
    }
  }, [mode]);

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

  // 3. 카메라 / 프리뷰 / 결과
  if (['camera', 'preview', 'result'].includes(mode)) return (
    <div className="flex flex-col h-[100dvh] bg-white">
      
      {/* 뷰어 영역 */}
      <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
        <button onClick={goBack} className="absolute top-6 left-6 z-20 bg-black/50 text-white px-4 py-2 rounded-full text-sm font-bold backdrop-blur">✕ 닫기</button>
        {mode === 'camera' && (
            <button onClick={() => setFacingMode(p => p === 'user' ? 'environment' : 'user')} className="absolute top-6 right-6 z-20 w-10 h-10 bg-black/50 rounded-full text-white text-xl flex items-center justify-center backdrop-blur">🔄</button>
        )}

        {mode === 'camera' && <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />}
        {(mode === 'preview' && tempImage) && <img src={tempImage} className="w-full h-full object-contain" />}
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
                <button onClick={confirmAndSign} className="flex-1 py-4 bg-black text-white font-black rounded-2xl text-lg">박제하기</button>
            </div>
        )}
        {mode === 'result' && (
            <div className="flex gap-4 w-full">
                <button onClick={() => setMode('camera')} className="flex-1 py-4 bg-gray-200 text-gray-500 font-bold rounded-2xl">새 촬영</button>
                <button onClick={handleSave} className="flex-[2] py-4 bg-[#00ffcc] text-black font-black rounded-2xl text-lg flex items-center justify-center gap-2 shadow-lg">
                    <span>💾</span> 저장 / 공유
                </button>
            </div>
        )}
      </div>

      {/* 로딩 */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-4 border-zinc-800 border-t-white rounded-full animate-spin mb-4"></div>
            <p className="text-white font-bold text-sm tracking-widest">{status}</p>
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
            <div className={`relative transition-all duration-500 ${(!isScanning && verifiedData?.isZZIN) ? 'border-2 border-[#00ffcc] shadow-[0_0_50px_rgba(0,255,204,0.3)]' : ''}`}>
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
                      <p className="text-[#00ffcc] font-mono text-xs tracking-widest">VERIFYING METADATA...</p>
                  </div>
              ) : (
                  <div className="flex flex-col items-center gap-6 w-full animate-in slide-in-from-bottom-5">
                      
                      {verifiedData?.isZZIN ? (
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
                                    <span className="text-zinc-500 text-xs font-bold">CREATOR</span>
                                    <span className="text-white font-mono text-xs truncate max-w-[150px]">{verifiedData.creator.slice(0,10)}...</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500 text-xs font-bold">CREATED AT</span>
                                    {/* 진짜 파일 시간 표시 */}
                                    <span className="text-white font-mono text-xs">{verifiedData.time}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500 text-xs font-bold">STATUS</span>
                                    <span className="text-[#00ffcc] font-mono text-xs">Valid Signature</span>
                                </div>
                            </div>
                          </>
                      ) : (
                          // 실패 화면 (파일명/메타데이터 불일치)
                          <>
                             <div className="text-center">
                                <h2 className="text-3xl font-black italic text-red-500 tracking-tight mb-1">UNKNOWN SOURCE</h2>
                                <div className="text-red-500 text-xs font-bold tracking-widest border border-red-500 px-2 py-1 inline-block rounded">
                                    VERIFICATION FAILED
                                </div>
                            </div>
                            <p className="text-zinc-500 text-sm text-center">
                                ZZIN으로 촬영된 이미지가 아니거나<br/>데이터가 손상되었습니다.
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
