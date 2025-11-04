import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize, Loader } from 'lucide-react';

export default function KickVODPlayer() {
  const [vodUrl, setVodUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [currentChunk, setCurrentChunk] = useState(1);
  const [loadedChunks, setLoadedChunks] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [quality, setQuality] = useState('1080p60');
  
  const videoRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const sourceBufferRef = useRef(null);
  const baseURLRef = useRef('');
  const currentChunkRef = useRef(1);
  const loadedChunksSetRef = useRef(new Set());
  const fetchingRef = useRef(false);
  const lastCheckedChunkRef = useRef(1);
  const hideControlsTimeoutRef = useRef(null);

  const extractSourceFromHTML = async (vodPageUrl) => {
    try {
      setIsLoading(true);
      setError('');
      
      console.warn('Extracting source from VOD page:', vodPageUrl);
      // Fetch the VOD page
      const corsProxy = 'https://proxy.cors.sh/';
      const finalUrl = vodPageUrl; //corsProxy + vodPageUrl;
      console.log(proxyUrl);
      const response = await fetch(proxyUrl);

      if (!response.ok) throw new Error('Failed to fetch VOD page');

      console.log('Fetched VOD page successfully');
      
      const html = await response.text();
      
      // Find the script tag with the source URL
      const sourceMatch = html.match(/"source\\?":\\?"(https:\/\/stream\.kick\.com\/ivs\/[^"]+master\.m3u8)\\?"/);
      
      if (!sourceMatch) {
        throw new Error('Could not find video source in page. Make sure this is a valid Kick VOD URL.');
      }
      
      let sourceUrl = sourceMatch[1];
      // Remove escaped quotes if any
      sourceUrl = sourceUrl.replace(/\\\"/g, '"').replace(/\\/g, '');
      
      console.log('Found source URL:', sourceUrl);
      
      // Replace master.m3u8 with quality setting
      const baseUrl = sourceUrl.replace('/master.m3u8', `/${quality}/`);
      
      console.log('Base URL:', baseUrl);
      
      return baseUrl;
    } catch (err) {
      console.error('Error extracting source:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const loadChunk = async (chunkNum) => {
    if (fetchingRef.current || !sourceBufferRef.current || loadedChunksSetRef.current.has(chunkNum)) {
      return false;
    }
    
    fetchingRef.current = true;
    const url = `${baseURLRef.current}${chunkNum}.ts`;
    console.log(`⬇️ Fetching chunk ${chunkNum}`);

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.arrayBuffer();
      if (data.byteLength === 0) throw new Error('Empty chunk');

      while (sourceBufferRef.current.updating) {
        await new Promise(resolve => {
          sourceBufferRef.current.addEventListener('updateend', resolve, { once: true });
        });
      }

      await new Promise((resolve, reject) => {
        const onUpdateEnd = () => {
          sourceBufferRef.current.removeEventListener('updateend', onUpdateEnd);
          sourceBufferRef.current.removeEventListener('error', onError);
          resolve();
        };
        
        const onError = (e) => {
          sourceBufferRef.current.removeEventListener('updateend', onUpdateEnd);
          sourceBufferRef.current.removeEventListener('error', onError);
          reject(e);
        };

        sourceBufferRef.current.addEventListener('updateend', onUpdateEnd);
        sourceBufferRef.current.addEventListener('error', onError);
        sourceBufferRef.current.appendBuffer(data);
      });

      loadedChunksSetRef.current.add(chunkNum);
      setLoadedChunks(loadedChunksSetRef.current.size);
      console.log(`✅ Appended chunk ${chunkNum} (${(data.byteLength / 1024).toFixed(2)} KB)`);
      
      fetchingRef.current = false;
      return true;

    } catch (err) {
      console.warn(`⚠️ Could not fetch chunk ${chunkNum}:`, err.message);
      fetchingRef.current = false;
      return false;
    }
  };

  const switchToChunk = async (chunkNum) => {
    if (chunkNum < 1) return;

    console.log(`🔄 Switching to chunk ${chunkNum}...`);
    const wasPlaying = !videoRef.current.paused;
    videoRef.current.pause();
    
    try {
      const buffered = sourceBufferRef.current.buffered;
      if (buffered.length > 0) {
        while (sourceBufferRef.current.updating) {
          await new Promise(resolve => {
            sourceBufferRef.current.addEventListener('updateend', resolve, { once: true });
          });
        }
        
        await new Promise((resolve) => {
          sourceBufferRef.current.addEventListener('updateend', resolve, { once: true });
          sourceBufferRef.current.remove(0, buffered.end(buffered.length - 1));
        });
      }
      
      loadedChunksSetRef.current.clear();
      setLoadedChunks(0);
      videoRef.current.currentTime = 0;
      currentChunkRef.current = chunkNum;
      lastCheckedChunkRef.current = chunkNum;
      setCurrentChunk(chunkNum);
      
      const success = await loadChunk(chunkNum);
      
      if (success) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (wasPlaying) {
          await videoRef.current.play();
        }
      }
    } catch (err) {
      console.error('Error switching chunk:', err);
      setError('Failed to switch chunk');
    }
  };

  const initializePlayer = async () => {
    try {
      // Extract base URL from Kick VOD page
      const baseUrl = await extractSourceFromHTML(vodUrl);
      
      baseURLRef.current = baseUrl;
      currentChunkRef.current = 1;
      lastCheckedChunkRef.current = 1;
      setCurrentChunk(1);
      loadedChunksSetRef.current.clear();
      setLoadedChunks(0);
      setError('');

      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      videoRef.current.src = URL.createObjectURL(mediaSource);

      mediaSource.addEventListener('sourceopen', async () => {
        const mimeTypes = [
          'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
          'video/mp4; codecs="avc1.640028, mp4a.40.2"',
          'video/mp4; codecs="avc1.4d401f, mp4a.40.2"'
        ];

        let supportedMime = null;
        for (const mime of mimeTypes) {
          if (MediaSource.isTypeSupported(mime)) {
            supportedMime = mime;
            break;
          }
        }

        if (!supportedMime) {
          setError('Browser does not support required video codecs');
          return;
        }

        const sourceBuffer = mediaSource.addSourceBuffer(supportedMime);
        sourceBuffer.mode = 'sequence';
        sourceBufferRef.current = sourceBuffer;

        await loadChunk(currentChunkRef.current);
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        try {
          await videoRef.current.play();
          setIsPlaying(true);
        } catch (err) {
          console.log('Autoplay prevented');
        }
        
        setIsInitialized(true);
      });
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = async () => {
      setCurrentTime(video.currentTime);
      
      if (sourceBufferRef.current && sourceBufferRef.current.buffered.length > 0) {
        const buffered = sourceBufferRef.current.buffered.end(sourceBufferRef.current.buffered.length - 1);
        setBufferedTime(buffered);
        
        if (!fetchingRef.current && !video.paused) {
          const bufferAhead = buffered - video.currentTime;
          
          if (bufferAhead < 3 && bufferAhead >= 0) {
            const nextChunk = lastCheckedChunkRef.current + 1;
            if (!loadedChunksSetRef.current.has(nextChunk)) {
              const success = await loadChunk(nextChunk);
              if (success) {
                lastCheckedChunkRef.current = nextChunk;
                currentChunkRef.current = nextChunk;
                setCurrentChunk(nextChunk);
              }
            }
          }
        }
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, []);

  const togglePlayPause = () => {
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    videoRef.current.volume = newVolume;
    setIsMuted(newVolume === 0);
  };

  const toggleMute = () => {
    if (isMuted) {
      videoRef.current.volume = volume || 0.5;
      setVolume(volume || 0.5);
      setIsMuted(false);
    } else {
      videoRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoRef.current.parentElement.requestFullscreen();
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    hideControlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl">
        {!isInitialized ? (
          <div className="bg-gray-800 rounded-lg shadow-2xl p-8">
            <h1 className="text-4xl font-bold text-white mb-6 text-center">
              Kick VOD Player
            </h1>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 mb-2 text-sm">
                  Enter Kick VOD URL
                </label>
                <input
                  type="text"
                  value={vodUrl}
                  onChange={(e) => setVodUrl(e.target.value)}
                  placeholder="https://kick.com/username/videos/video-id"
                  className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              
              <div>
                <label className="block text-gray-300 mb-2 text-sm">
                  Quality
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="1080p60">1080p60</option>
                  <option value="1080p">1080p</option>
                  <option value="720p60">720p60</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                  <option value="360p">360p</option>
                </select>
              </div>
              
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}
              
              <button
                onClick={initializePlayer}
                disabled={!vodUrl || isLoading}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader className="animate-spin" size={20} />
                    Loading...
                  </>
                ) : (
                  'Load Video'
                )}
              </button>
            </div>
            
            <div className="mt-6 text-gray-400 text-sm space-y-2">
              <p>💡 <strong>How to use:</strong></p>
              <ol className="list-decimal list-inside space-y-1 ml-4">
                <li>Go to any Kick VOD page (e.g., kick.com/username/videos/xxx)</li>
                <li>Copy the full URL from your browser</li>
                <li>Paste it above, select quality, and click "Load Video"</li>
                <li>The player will automatically extract the stream URL and start playing</li>
              </ol>
              <p className="mt-3 text-xs text-gray-500">
                ⚠️ Note: This may not work due to CORS restrictions. The page needs to be accessible without authentication.
              </p>
            </div>
          </div>
        ) : (
          <div 
            className="relative bg-black rounded-lg overflow-hidden shadow-2xl"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => isPlaying && setShowControls(false)}
          >
            <video
              ref={videoRef}
              className="w-full aspect-video"
              onClick={togglePlayPause}
            />
            
            {/* Controls Overlay */}
            <div 
              className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity duration-300 ${
                showControls ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ pointerEvents: showControls ? 'auto' : 'none' }}
            >
              {/* Top Bar */}
              <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/60 to-transparent">
                <div className="flex items-center justify-between text-white text-sm">
                  <div>
                    <span className="font-semibold">Chunk {currentChunk}</span>
                    <span className="ml-3 text-gray-300">Loaded: {loadedChunks}</span>
                    <span className="ml-3 text-purple-400">{quality}</span>
                  </div>
                  <button
                    onClick={() => {
                      setIsInitialized(false);
                      videoRef.current.src = '';
                    }}
                    className="text-gray-300 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Bottom Controls */}
              <div className="absolute bottom-0 left-0 right-0 p-4">
                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="relative h-1 bg-gray-600 rounded-full cursor-pointer group">
                    <div 
                      className="absolute h-full bg-gray-400 rounded-full"
                      style={{ width: `${(bufferedTime / (bufferedTime + 10)) * 100}%` }}
                    />
                    <div 
                      className="absolute h-full bg-purple-500 rounded-full"
                      style={{ width: `${(currentTime / (bufferedTime + 10)) * 100}%` }}
                    />
                    <div 
                      className="absolute w-3 h-3 bg-purple-500 rounded-full -top-1 transition-opacity opacity-0 group-hover:opacity-100"
                      style={{ left: `${(currentTime / (bufferedTime + 10)) * 100}%`, transform: 'translateX(-50%)' }}
                    />
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-between text-white">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={togglePlayPause}
                      className="hover:text-purple-400 transition-colors"
                    >
                      {isPlaying ? <Pause size={28} /> : <Play size={28} />}
                    </button>
                    
                    <button
                      onClick={() => switchToChunk(currentChunk - 1)}
                      className="hover:text-purple-400 transition-colors"
                    >
                      <SkipBack size={24} />
                    </button>
                    
                    <button
                      onClick={() => switchToChunk(currentChunk + 1)}
                      className="hover:text-purple-400 transition-colors"
                    >
                      <SkipForward size={24} />
                    </button>

                    <div className="text-sm">
                      {formatTime(currentTime)} / {formatTime(bufferedTime)}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 group">
                      <button
                        onClick={toggleMute}
                        className="hover:text-purple-400 transition-colors"
                      >
                        {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-0 group-hover:w-20 transition-all duration-300 h-1 bg-gray-600 rounded-full appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${(isMuted ? 0 : volume) * 100}%, #4b5563 ${(isMuted ? 0 : volume) * 100}%, #4b5563 100%)`
                        }}
                      />
                    </div>

                    <button
                      onClick={toggleFullscreen}
                      className="hover:text-purple-400 transition-colors"
                    >
                      <Maximize size={24} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}