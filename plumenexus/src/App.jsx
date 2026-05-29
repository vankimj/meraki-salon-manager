import { useEffect, useState } from 'react';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import StudioStrip from './components/StudioStrip.jsx';
import NumbersStatement from './components/NumbersStatement.jsx';
import LogoStrip from './components/LogoStrip.jsx';
import Features from './components/Features.jsx';
import Showcase from './components/Showcase.jsx';
import Reveal from './components/Reveal.jsx';
import AISection from './components/AISection.jsx';
import Compare from './components/Compare.jsx';
import Pricing from './components/Pricing.jsx';
import DemoBooking from './components/DemoBooking.jsx';
import Testimonials from './components/Testimonials.jsx';
import Testimonial from './components/Testimonial.jsx';
import FAQ from './components/FAQ.jsx';
import Contact from './components/Contact.jsx';
import Footer from './components/Footer.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import StickyCTA from './components/StickyCTA.jsx';
import TermsPage from './components/TermsPage.jsx';
import PrivacyPage from './components/PrivacyPage.jsx';
import TrustPage from './components/TrustPage.jsx';
import NotFoundPage from './components/NotFoundPage.jsx';
import SignupPage from './components/SignupPage.jsx';
import SmsConsentPage from './components/SmsConsentPage.jsx';

const KNOWN_PATHS = new Set(['/', '/terms', '/privacy', '/trust', '/book', '/signup', '/sms-consent']);
const norm = (p) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

export default function App() {
  // Trivial path-based routing — no react-router for a handful of extra paths.
  const [path, setPath] = useState(norm(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(norm(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Smooth-scroll handler for in-page anchor nav links.
  useEffect(() => {
    function onClick(e) {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href').slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      const top = el.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // /book is just a deep-link to the demo section on the homepage.
  // Scroll once after mount so the user lands on the booking widget.
  useEffect(() => {
    if (path === '/book') {
      // Update browser bar to / so refresh stays consistent
      window.history.replaceState({}, '', '/#demo');
      requestAnimationFrame(() => {
        const el = document.getElementById('demo');
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - 70;
          window.scrollTo({ top, behavior: 'instant' in window ? 'instant' : 'auto' });
        }
      });
    }
  }, [path]);

  if (path === '/terms')   return <TermsPage />;
  if (path === '/privacy') return <PrivacyPage />;
  if (path === '/trust')   return <TrustPage />;
  if (path === '/signup')      return <SignupPage />;
  if (path === '/sms-consent') return <SmsConsentPage />;
  if (!KNOWN_PATHS.has(path)) return <NotFoundPage />;

  return (
    <>
      <a href="#main" className="pn-skip-link">Skip to main content</a>
      <Nav />
      <main id="main">
        <Hero />
        <Reveal><StudioStrip /></Reveal>
        <NumbersStatement />
        <Reveal><LogoStrip /></Reveal>
        <Features />
        <Reveal><Showcase /></Reveal>
        <Reveal><AISection /></Reveal>
        <Reveal><Compare /></Reveal>
        <Reveal><Pricing /></Reveal>
        <Reveal><DemoBooking /></Reveal>
        <Reveal><Testimonials /></Reveal>
        <Reveal><Testimonial /></Reveal>
        <Reveal><FAQ /></Reveal>
        <Reveal><Contact /></Reveal>
      </main>
      <Footer />
      <ChatWidget />
      <StickyCTA />
    </>
  );
}
