import React, { useEffect, useRef, useState } from 'react';
import p5 from 'p5';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Thermometer, Activity, Waves, Info, Settings2, Zap } from 'lucide-react';

// --- Types ---
interface Wave {
  r: number;
  v: number;
  x?: number;
  y?: number;
  dir?: number;
}

interface Particle {
  anchor: { x: number; y: number };
}

type LabMode = 'speed' | 'doppler' | 'sonar';

interface Material {
  name: string;
  speed: number;
}

const MATERIALS: Material[] = [
  { name: 'Air (Variable)', speed: 0 }, // 0 means use temp formula
  { name: 'Rubber', speed: 54 },
  { name: 'Carbon Dioxide', speed: 260 },
  { name: 'Cork', speed: 500 },
  { name: 'Water', speed: 1483 },
  { name: 'Wood', speed: 3850 },
  { name: 'Steel', speed: 5060 },
];

const PROBLEMS = [
  {
    id: 1,
    question: "On a hot day (35°C), what is the speed of sound in air?",
    answer: 352,
    unit: "m/s",
    hint: "Use v = 331 + 0.6 * Tc"
  },
  {
    id: 2,
    question: "If I = 1.0e-5 W/m², what is the intensity level in dB?",
    answer: 70,
    unit: "dB",
    hint: "Use β = 10 * log10(I / 1e-12)"
  },
  {
    id: 3,
    question: "Ambulance (400Hz) approaches at 25m/s. Sound speed is 340m/s. Frequency heard?",
    answer: 431.75,
    unit: "Hz",
    hint: "Use fo = f * (v / (v - vs))"
  }
];

// --- Audio Helper (Web Audio API) ---
// We use this instead of p5.sound to avoid Vite/ESM compatibility issues with p5.sound
class AudioEngine {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.gain.gain.value = 0;
  }

  start() {
    if (!this.ctx || this.osc) return;
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.connect(this.gain!);
    this.osc.start();
  }

  setFreq(f: number) {
    if (this.osc && this.ctx) {
      this.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    }
  }

  setAmp(a: number, t: number = 0.1) {
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(a, this.ctx.currentTime, t);
    }
  }

  playBeep(f: number, d: number) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, this.ctx.currentTime);
    g.connect(this.ctx.destination);
    o.connect(g);
    g.gain.setValueAtTime(0.3, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + d);
    o.start();
    o.stop(this.ctx.currentTime + d);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
}

const audioEngine = new AudioEngine();

export default function SoundLab() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [mode, setMode] = useState<LabMode>('speed');
  const [temp, setTemp] = useState(20);
  const [freq, setFreq] = useState(440);
  const [selectedMaterial, setSelectedMaterial] = useState(MATERIALS[0]);
  const [isPracticeOpen, setIsPracticeOpen] = useState(false);
  const [isObjectivesOpen, setIsObjectivesOpen] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizFeedback, setQuizFeedback] = useState<Record<number, string>>({});
  const [velocity, setVelocity] = useState(0);
  const [wavelength, setWavelength] = useState(0);
  const [status, setStatus] = useState('Waiting for Start...');

  // p5 instance ref
  const p5Ref = useRef<p5 | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const sketch = (p: p5) => {
      let waves: Wave[] = [];
      let particles: Particle[] = [];
      let currentMode: LabMode = 'speed';
      let currentFreq = 440;
      let currentTemp = 20;

      p.setup = () => {
        const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
        canvas.parent(containerRef.current!);
        
        // Initialize Particles (Air Molecules)
        for (let i = 0; i < 400; i++) {
          particles.push({
            anchor: { x: p.random(p.width), y: p.random(p.height) }
          });
        }
      };

      p.draw = () => {
        p.background(5, 10, 20);
        drawGrid(p);

        let v = selectedMaterial.speed > 0 ? selectedMaterial.speed : 331 + (0.6 * currentTemp);
        const waveLen = v / currentFreq;

        // Update React state via props or external mechanism if needed, 
        // but here we'll just use the values passed in
        
        if (!isStarted) return;

        if (currentMode === 'speed') {
          runSpeedLab(p, v, currentFreq, waves, particles);
        } else if (currentMode === 'doppler') {
          runDopplerLab(p, v, currentFreq, waves);
        } else if (currentMode === 'sonar') {
          runSonarLab(p, v, waves);
        }

        drawOscilloscope(p, currentFreq);
      };

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
      };

      // Helper functions inside sketch
      const drawGrid = (p: p5) => {
        p.stroke(255, 15);
        for (let i = 0; i < p.width; i += 50) p.line(i, 0, i, p.height);
        for (let i = 0; i < p.height; i += 50) p.line(0, i, p.width, i);
      };

      const runSpeedLab = (p: p5, v: number, f: number, waves: Wave[], particles: Particle[]) => {
        audioEngine.setFreq(f);
        audioEngine.setAmp(0.1);

        if (p.frameCount % Math.floor(p.map(f, 100, 1200, 60, 5)) === 0) {
          waves.push({ r: 0, v: v / 5 });
        }

        p.noFill();
        for (let i = waves.length - 1; i >= 0; i--) {
          let opacity = p.map(waves[i].r, 0, p.width, 255, 0);
          p.stroke(0, 242, 255, opacity);
          p.ellipse(p.width / 2, p.height / 2, waves[i].r);
          waves[i].r += waves[i].v;
          if (waves[i].r > p.width) waves.splice(i, 1);
        }

        p.fill(255, 150);
        p.noStroke();
        for (let part of particles) {
          let d = p.dist(part.anchor.x, part.anchor.y, p.width / 2, p.height / 2);
          let shift = p.sin(p.frameCount * 0.15 - d * (f / 2000)) * 10;
          p.ellipse(part.anchor.x + shift, part.anchor.y, 2);
        }
      };

      const runDopplerLab = (p: p5, v: number, f: number, waves: Wave[]) => {
        let speed = (p.mouseX - p.pmouseX);
        let shiftedFreq = f * (v / (v + speed));
        audioEngine.setFreq(shiftedFreq);
        audioEngine.setAmp(0.1);

        if (p.frameCount % 10 === 0) {
          waves.push({ x: p.mouseX, y: p.mouseY, r: 0, v: v / 5 });
        }

        p.noFill();
        for (let i = waves.length - 1; i >= 0; i--) {
          let opacity = p.map(waves[i].r, 0, 500, 255, 0);
          p.stroke(255, 255, 0, opacity);
          if (waves[i].x !== undefined && waves[i].y !== undefined) {
            p.ellipse(waves[i].x!, waves[i].y!, waves[i].r);
          }
          waves[i].r += waves[i].v;
          if (waves[i].r > 500) waves.splice(i, 1);
        }
        p.fill(255, 255, 0);
        p.noStroke();
        p.text("🚨 SIREN (DRAG MOUSE)", p.mouseX - 50, p.mouseY - 25);
      };

      const runSonarLab = (p: p5, v: number, waves: Wave[]) => {
        audioEngine.setAmp(0);
        let boatX = p.width / 2, boatY = 150, seabedY = p.height - 150;

        p.fill(200);
        p.rect(boatX - 60, boatY - 20, 120, 20, 5);
        p.fill(139, 69, 19);
        p.rect(0, seabedY, p.width, 150);

        if (p.frameCount % 120 === 0) {
          waves.push({ y: boatY, v: v / 4, r: 0, dir: 1 });
          audioEngine.playBeep(800, 0.1);
        }

        for (let i = waves.length - 1; i >= 0; i--) {
          p.stroke(0, 255, 100);
          p.strokeWeight(3);
          if (waves[i].y !== undefined) {
            p.line(boatX - 40, waves[i].y!, boatX + 40, waves[i].y!);
            waves[i].y! += waves[i].v * (waves[i].dir || 1);

            if (waves[i].y! > seabedY && waves[i].dir === 1) {
              waves[i].dir = -1;
              audioEngine.playBeep(400, 0.05);
            }
            if (waves[i].y! < boatY && waves[i].dir === -1) {
              waves.splice(i, 1);
              audioEngine.playBeep(1200, 0.1);
            }
          }
        }
      };

      const drawOscilloscope = (p: p5, f: number) => {
        p.push();
        p.translate(0, p.height - 100);
        p.fill(0, 80);
        p.stroke(0, 242, 255, 80);
        p.rect(0, 0, p.width, 100);
        p.noFill();
        p.stroke(0, 242, 255);
        p.strokeWeight(2);
        p.beginShape();
        for (let x = 0; x < p.width; x += 5) {
          let y = p.sin(x * (f / 1500) + p.frameCount * 0.2) * 35 + 50;
          p.vertex(x, y);
        }
        p.endShape();
        p.pop();
      };

      // Expose setters to the React component
      (p as any).updateParams = (m: LabMode, f: number, t: number) => {
        currentMode = m;
        currentFreq = f;
        currentTemp = t;
      };
    };

    p5Ref.current = new p5(sketch);

    return () => {
      p5Ref.current?.remove();
    };
  }, [isStarted]);

  // Update p5 instance when React state changes
  useEffect(() => {
    if (p5Ref.current && (p5Ref.current as any).updateParams) {
      (p5Ref.current as any).updateParams(mode, freq, temp);
    }
    
    const v = selectedMaterial.speed > 0 ? selectedMaterial.speed : 331 + (0.6 * temp);
    setVelocity(v);
    setWavelength(v / freq);

    if (isStarted) {
      if (mode === 'speed') setStatus('Simulating: Air Molecules');
      else if (mode === 'doppler') setStatus('Doppler Shift Active');
      else if (mode === 'sonar') setStatus('Echo Sounding Active');
    }
  }, [mode, freq, temp, isStarted]);

  const handleStart = () => {
    audioEngine.init();
    audioEngine.start();
    audioEngine.resume();
    setIsStarted(true);
    setStatus('System Online');
  };

  const exportLabReport = () => {
    const report = `
PHYSICS 202: LABORATORY REPORT
==============================
Date: ${new Date().toLocaleString()}
Experiment: Sound Wave Propagation

PARAMETERS:
- Mode: ${mode.toUpperCase()}
- Material: ${selectedMaterial.name}
- Temperature: ${temp}°C
- Frequency: ${freq} Hz

RESULTS:
- Calculated Velocity: ${velocity.toFixed(2)} m/s
- Wavelength: ${wavelength.toFixed(2)} m

STATUS: ${status}
==============================
Generated by SoundLab Explorer
    `;
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lab_Report_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Report Exported');
  };

  const checkQuiz = (id: number) => {
    const problem = PROBLEMS.find(p => p.id === id);
    const userAns = parseFloat(quizAnswers[id]);
    if (Math.abs(userAns - problem!.answer) < 1) {
      setQuizFeedback(prev => ({ ...prev, [id]: '✅ Correct!' }));
    } else {
      setQuizFeedback(prev => ({ ...prev, [id]: `❌ Try again! Hint: ${problem!.hint}` }));
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#050a10] font-sans text-[#00f2ff]">
      {/* Background Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Control Panel */}
      <div className="absolute top-6 left-6 z-10 w-72">
        <AnimatePresence mode="wait">
          {!isStarted ? (
            <motion.button
              key="start-btn"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.1, opacity: 0 }}
              onClick={handleStart}
              className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-[#ff0055] py-5 text-lg font-bold text-white shadow-[0_4px_0_#990033] transition-all active:translate-y-1 active:shadow-none"
            >
              <Play className="h-6 w-6 fill-current" />
              <span>START LABORATORY</span>
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
            </motion.button>
          ) : (
            <motion.div
              key="lab-controls"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="flex flex-col gap-6 rounded-2xl border border-[#00f2ff]/30 bg-[#0a1428]/90 p-6 backdrop-blur-xl shadow-[0_0_30px_rgba(0,242,255,0.15)]"
            >
              <div className="flex items-center gap-2 border-b border-[#00f2ff]/20 pb-3">
                <Settings2 className="h-5 w-5" />
                <h2 className="text-sm font-bold uppercase tracking-wider">Lab Configuration</h2>
              </div>

              <button
                onClick={() => setIsObjectivesOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#ff0055]/40 bg-[#ff0055]/10 py-2 text-[10px] font-bold uppercase tracking-widest text-[#ff0055] transition-all hover:bg-[#ff0055]/20"
              >
                <Info className="h-3 w-3" />
                Theory & Objectives
              </button>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setMode('speed')}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-bold transition-all ${
                    mode === 'speed'
                      ? 'border-[#00f2ff] bg-[#00f2ff] text-black'
                      : 'border-[#00f2ff]/30 bg-[#1a2a4a]/50 hover:bg-[#1a2a4a]'
                  }`}
                >
                  <Waves className="h-4 w-4" />
                  1. Speed & Temperature
                </button>
                <button
                  onClick={() => setMode('doppler')}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-bold transition-all ${
                    mode === 'doppler'
                      ? 'border-[#00f2ff] bg-[#00f2ff] text-black'
                      : 'border-[#00f2ff]/30 bg-[#1a2a4a]/50 hover:bg-[#1a2a4a]'
                  }`}
                >
                  <Zap className="h-4 w-4" />
                  2. Doppler Effect
                </button>
                <button
                  onClick={() => setMode('sonar')}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-bold transition-all ${
                    mode === 'sonar'
                      ? 'border-[#00f2ff] bg-[#00f2ff] text-black'
                      : 'border-[#00f2ff]/30 bg-[#1a2a4a]/50 hover:bg-[#1a2a4a]'
                  }`}
                >
                  <Activity className="h-4 w-4" />
                  3. Sonar Echo Depth
                </button>
              </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-tighter">
                      <span className="flex items-center gap-1">
                        <Waves className="h-3 w-3" /> MATERIAL
                      </span>
                    </div>
                    <select
                      value={selectedMaterial.name}
                      onChange={(e) => {
                        const mat = MATERIALS.find(m => m.name === e.target.value);
                        if (mat) setSelectedMaterial(mat);
                      }}
                      className="w-full rounded-lg border border-[#00f2ff]/30 bg-[#1a2a4a] px-3 py-2 text-xs font-bold text-[#00f2ff] outline-none focus:border-[#00f2ff]"
                    >
                      {MATERIALS.map(m => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                  <div className="flex justify-between text-xs font-bold uppercase tracking-tighter">
                    <span className="flex items-center gap-1">
                      <Thermometer className="h-3 w-3" /> TEMP (Tc)
                    </span>
                    <span className="text-[#ff0055]">{temp}°C</span>
                  </div>
                  <input
                    type="range"
                    min="-50"
                    max="100"
                    value={temp}
                    onChange={(e) => setTemp(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#1a2a4a] accent-[#ff0055]"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-bold uppercase tracking-tighter">
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" /> FREQUENCY
                    </span>
                    <span className="text-[#ff0055]">{freq} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="1200"
                    value={freq}
                    onChange={(e) => setFreq(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#1a2a4a] accent-[#ff0055]"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Data Box */}
      <div className="absolute top-6 right-6 z-10">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="rounded-xl border border-[#00f2ff]/30 bg-black/80 p-5 font-mono text-sm backdrop-blur-md shadow-2xl"
        >
          <div className="mb-3 flex items-center gap-2 text-[#ff0055]">
            <Info className="h-4 w-4" />
            <span className="font-bold uppercase tracking-widest">Research Data</span>
          </div>
          <div className="space-y-1.5 text-[#00f2ff]/90">
            <div className="flex justify-between gap-8">
              <span className="opacity-60">Velocity (v):</span>
              <span className="font-bold">{velocity.toFixed(2)} m/s</span>
            </div>
            <div className="flex justify-between gap-8">
              <span className="opacity-60">Wavelength (λ):</span>
              <span className="font-bold">{wavelength.toFixed(2)} m</span>
            </div>
            <div className="mt-3 border-t border-[#00f2ff]/10 pt-3">
              <div className="flex justify-between gap-8">
                <span className="opacity-60">Status:</span>
                <span className="text-white">{status}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={exportLabReport}
                className="w-full rounded-lg bg-[#00f2ff]/10 py-2 text-[10px] font-bold uppercase tracking-widest text-[#00f2ff] border border-[#00f2ff]/20 hover:bg-[#00f2ff]/20 transition-all"
              >
                Export Lab Report
              </button>
              <button
                onClick={() => setIsPracticeOpen(true)}
                className="w-full rounded-lg bg-[#ff0055]/10 py-2 text-[10px] font-bold uppercase tracking-widest text-[#ff0055] border border-[#ff0055]/20 hover:bg-[#ff0055]/20 transition-all"
              >
                Practice Problems
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Objectives Modal */}
      <AnimatePresence>
        {isObjectivesOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl border border-[#00f2ff]/30 bg-[#0a1428] p-8 shadow-2xl custom-scrollbar"
            >
              <div className="mb-6 flex items-center justify-between border-b border-[#00f2ff]/20 pb-4">
                <div className="flex items-center gap-3">
                  <Zap className="h-6 w-6 text-[#ff0055]" />
                  <h2 className="text-xl font-bold uppercase tracking-widest text-[#00f2ff]">Theory & Objectives</h2>
                </div>
                <button
                  onClick={() => setIsObjectivesOpen(false)}
                  className="text-[#00f2ff]/50 hover:text-[#ff0055] font-bold"
                >
                  CLOSE
                </button>
              </div>

              <div className="space-y-8 text-[#00f2ff]/80">
                <section>
                  <h3 className="text-sm font-bold uppercase tracking-tighter text-[#ff0055] mb-3">Learning Objectives</h3>
                  <ul className="list-disc list-inside space-y-2 text-sm">
                    <li>Define sound waves as longitudinal mechanical waves.</li>
                    <li>Calculate the speed of sound in various media and temperatures.</li>
                    <li>Identify the ranges of the sound frequency spectrum (Audible, Infrasonic, Ultrasonic).</li>
                    <li>Explain the Doppler Effect and calculate apparent frequency shifts.</li>
                    <li>Understand sound behaviors: reflection, refraction, and resonance.</li>
                  </ul>
                </section>

                <section className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-tighter text-[#ff0055]">Core Theory</h3>
                  
                  <div className="rounded-lg bg-[#1a2a4a]/50 p-4 border border-[#00f2ff]/10">
                    <h4 className="text-xs font-bold text-white mb-2">1. Speed of Sound</h4>
                    <p className="text-xs leading-relaxed">
                      Sound speed depends on the elasticity and density of the medium. 
                      In air, it varies with temperature: <br/>
                      <span className="text-[#00f2ff] font-mono">v = 331 + 0.6Tc (m/s)</span>
                    </p>
                  </div>

                  <div className="rounded-lg bg-[#1a2a4a]/50 p-4 border border-[#00f2ff]/10">
                    <h4 className="text-xs font-bold text-white mb-2">2. Frequency Spectrum</h4>
                    <p className="text-xs leading-relaxed">
                      • <span className="text-white">Audible:</span> 20 Hz – 20,000 Hz <br/>
                      • <span className="text-white">Infrasonic:</span> Below 20 Hz <br/>
                      • <span className="text-white">Ultrasonic:</span> Above 20,000 Hz
                    </p>
                  </div>

                  <div className="rounded-lg bg-[#1a2a4a]/50 p-4 border border-[#00f2ff]/10">
                    <h4 className="text-xs font-bold text-white mb-2">3. The Doppler Effect</h4>
                    <p className="text-xs leading-relaxed">
                      The apparent change in frequency caused by the motion of the source or observer. 
                      Pitch increases as they approach and decreases as they depart.
                    </p>
                  </div>
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Practice Modal */}
      <AnimatePresence>
        {isPracticeOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-lg rounded-2xl border border-[#00f2ff]/30 bg-[#0a1428] p-8 shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between border-b border-[#00f2ff]/20 pb-4">
                <h2 className="text-xl font-bold uppercase tracking-widest text-[#00f2ff]">Practice Mode</h2>
                <button
                  onClick={() => setIsPracticeOpen(false)}
                  className="text-[#00f2ff]/50 hover:text-[#ff0055]"
                >
                  CLOSE
                </button>
              </div>

              <div className="space-y-8">
                {PROBLEMS.map((prob) => (
                  <div key={prob.id} className="space-y-3">
                    <p className="text-sm font-medium text-white">{prob.id}. {prob.question}</p>
                    <div className="flex gap-3">
                      <input
                        type="number"
                        placeholder="Your answer..."
                        value={quizAnswers[prob.id] || ''}
                        onChange={(e) => setQuizAnswers(prev => ({ ...prev, [prob.id]: e.target.value }))}
                        className="flex-1 rounded-lg border border-[#00f2ff]/20 bg-[#1a2a4a] px-4 py-2 text-sm text-white outline-none focus:border-[#00f2ff]"
                      />
                      <button
                        onClick={() => checkQuiz(prob.id)}
                        className="rounded-lg bg-[#00f2ff] px-6 py-2 text-xs font-bold text-black hover:bg-white transition-all"
                      >
                        CHECK
                      </button>
                    </div>
                    {quizFeedback[prob.id] && (
                      <p className={`text-[10px] font-bold uppercase ${quizFeedback[prob.id].includes('✅') ? 'text-green-400' : 'text-[#ff0055]'}`}>
                        {quizFeedback[prob.id]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <div className="absolute bottom-6 left-6 z-10 pointer-events-none">
        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#00f2ff]/40">
          <span>Physics 202: Laboratory</span>
          <span className="h-1 w-1 rounded-full bg-[#00f2ff]/20" />
          <span>Sound Waves Explorer</span>
        </div>
      </div>
    </div>
  );
}
