import { useEffect, useRef } from 'react';
import { Activity, ArrowDown, ArrowUpRight, BellRing, Plane, RadioTower, Route } from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { mediaTimeForProgress, shouldHideHeroInterface, shouldSeek } from './landing-utils';
import './landing.css';

gsap.registerPlugin(ScrollTrigger);

const poster = '/aerotrace-takeoff-poster.jpg';
const videoUrl = '/aerotrace-takeoff.mp4';

const features = [
  { icon: RadioTower, label: '01 / LIVE AIRSPACE', title: 'See the sky as it moves.', text: 'Explore live aircraft activity across India with a map that follows your view.' },
  { icon: Activity, label: '02 / TELEMETRY', title: 'Every signal, in context.', text: 'Read altitude, groundspeed, heading, vertical rate and observation freshness at a glance.' },
  { icon: Route, label: '03 / HISTORY & REPLAY', title: 'Follow the path behind.', text: 'Review locally recorded movement trails and replay the observations your dashboard captured.' },
  { icon: BellRing, label: '04 / CUSTOM ALERTS', title: 'Stay close to what matters.', text: 'Set altitude, speed and geographic boundary alerts for aircraft in your live view.' },
];

export default function LandingPage() {
  const heroRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const heroUiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || !heroRef.current) return;

    let progress = 0;
    let raf = 0;
    let lastUiHidden = false;
    const video = videoRef.current;
    const hero = heroRef.current;
    const heroUi = heroUiRef.current;

    const seek = () => {
      raf = 0;
      if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA || !Number.isFinite(video.duration)) return;
      const time = mediaTimeForProgress(progress, video.duration);
      if (shouldSeek(video.currentTime, time)) {
        try { video.currentTime = time; } catch { /* Keep the poster visible if the browser cannot seek yet. */ }
      }
    };
    const onMetadata = () => seek();
    video?.addEventListener('loadedmetadata', onMetadata);
    video?.addEventListener('durationchange', onMetadata);

    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, syncTouch: false });
    const syncScroll = () => ScrollTrigger.update();
    lenis.on('scroll', syncScroll);
    const ticker = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(ticker);
    gsap.ticker.lagSmoothing(0);

    const trigger = ScrollTrigger.create({
      trigger: hero,
      start: 'top top',
      end: '+=350%',
      pin: true,
      scrub: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        progress = self.progress;
        if (!raf) raf = window.requestAnimationFrame(seek);
        const hidden = shouldHideHeroInterface(progress);
        if (hidden !== lastUiHidden && heroUi) {
          lastUiHidden = hidden;
          gsap.to(heroUi, { autoAlpha: hidden ? 0 : 1, duration: 0.22, overwrite: true });
        }
      },
    });
    if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
    ScrollTrigger.refresh();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      trigger.kill();
      lenis.off('scroll', syncScroll);
      lenis.destroy();
      gsap.ticker.remove(ticker);
      gsap.ticker.lagSmoothing(500, 33);
      video?.removeEventListener('loadedmetadata', onMetadata);
      video?.removeEventListener('durationchange', onMetadata);
    };
  }, []);

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <main className="landing-page">
      <section className={`landing-hero${reducedMotion ? ' landing-hero-static' : ''}`} ref={heroRef} aria-label="AEROTRACE takeoff">
        <img className="landing-poster" src={poster} alt="Aircraft on a runway at golden hour" />
        {!reducedMotion && <video ref={videoRef} className="landing-video" src={videoUrl} poster={poster} muted playsInline preload="auto" aria-label="Aircraft takeoff at golden hour; scroll to scrub the video" />}
        <div className="landing-vignette" aria-hidden="true" />
        <div ref={heroUiRef} className="landing-hero-ui">
          <header className="landing-nav">
            <a className="landing-brand" href="/" aria-label="AEROTRACE home"><Plane size={17} strokeWidth={1.7} /><span>AEROTRACE</span></a>
            <nav aria-label="Main navigation">
              <a className="landing-nav-link" href="#capabilities">Airspace intelligence</a>
              <a className="landing-launch" href="/dashboard">Launch Radar <ArrowUpRight size={15} /></a>
            </nav>
          </header>
          <div className="landing-hero-meta"><span>AEROTRACE <i>/</i> AIRSPACE INTELLIGENCE</span><span className="landing-scroll-hint"><ArrowDown size={13} /> SCROLL TO TAKE FLIGHT</span></div>
        </div>
        <span className="landing-sr-only" aria-live="polite">{reducedMotion ? 'Static takeoff poster shown because reduced motion is enabled.' : 'Scroll to move through the takeoff video.'}</span>
      </section>

      <section className="landing-capabilities" id="capabilities">
        <div className="landing-section-top"><span>AN AIRSPACE PICTURE, IN MOTION</span><span>INDIA / LIVE VIEW</span></div>
        <div className="landing-intro"><p className="landing-kicker">A CLEARER VIEW OF THE SKY</p><h1>Flight activity,<br /><em>made visible.</em></h1><p className="landing-intro-copy">AEROTRACE brings live aircraft observations, useful telemetry and recorded movement into one focused airspace dashboard.</p></div>
        <div className="landing-feature-grid">
          {features.map(({ icon: Icon, label, title, text }) => <article className="landing-feature" key={label}><div className="landing-feature-head"><Icon size={17} /><span>{label}</span></div><h2>{title}</h2><p>{text}</p></article>)}
        </div>
      </section>

      <section className="landing-finale">
        <div className="landing-finale-orbit" aria-hidden="true"><span /><span /><span /></div>
        <p className="landing-kicker">AEROTRACE / AIRSPACE INTELLIGENCE</p>
        <h2>THE SKY IS<br /><em>ALREADY MOVING.</em></h2>
        <a className="landing-enter" href="/dashboard">ENTER LIVE RADAR <ArrowUpRight size={16} /></a>
        <footer><a href="/">AEROTRACE</a><span>LIVE AIRSPACE / INDIA</span></footer>
      </section>
    </main>
  );
}
