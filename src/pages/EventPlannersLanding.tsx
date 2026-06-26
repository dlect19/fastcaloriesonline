import { Link } from 'react-router-dom';
import { CalendarHeart, Ticket, Wallet, ShieldCheck, BarChart3, Users, ArrowRight, CheckCircle2 } from 'lucide-react';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

export default function EventPlannersLanding() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-bold">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-8 h-8 rounded-lg" />
            Fast Calories <span className="text-primary">Events</span>
          </a>
          <div className="flex items-center gap-2">
            <Link to="/organizer/auth" className="text-sm px-3 py-1.5 rounded hover:bg-secondary">Log in</Link>
            <Link to="/organizer/auth" className="text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground">Become a planner</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-4 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto text-center space-y-5">
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full bg-primary/10 text-primary">
            <Ticket className="w-3.5 h-3.5" /> For event organisers in Nigeria
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
            Sell event tickets. Get paid in <span className="text-primary">Naira</span>. No headaches.
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            List your event on Fast Calories, accept ticket payments online, manage check-in,
            and withdraw your earnings straight to your bank account — all from one dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link to="/organizer/auth" className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-primary text-primary-foreground font-semibold">
              Become an event planner <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#how-it-works" className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg border border-border font-semibold">
              See how it works
            </a>
          </div>
          <p className="text-xs text-muted-foreground">Only a 5% platform fee on ticket sales. No setup cost.</p>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-12 bg-secondary/30 border-y border-border">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Ticket, title: 'Online ticket sales', body: 'Multiple ticket types, bundles, promo codes and seat maps for venue events.' },
            { icon: Wallet, title: 'Wallet & instant withdrawal', body: 'Earnings land in your organizer wallet. Withdraw to any Nigerian bank, OTP-secured.' },
            { icon: Users, title: 'Check-in app', body: 'Scan tickets at the door. QR-validated, fraud-proof, works offline.' },
            { icon: BarChart3, title: 'Real-time analytics', body: 'Sold tickets, revenue, capacity utilisation and buyer demographics live.' },
            { icon: ShieldCheck, title: 'Verified payments', body: 'Paystack-powered checkout. Refund handling and dispute support built-in.' },
            { icon: CalendarHeart, title: 'Vouchers & sponsors', body: 'Issue branded vouchers, track redemption and settle sponsor costs automatically.' },
          ].map((f) => (
            <div key={f.title} className="bg-card border border-border rounded-xl p-4">
              <f.icon className="w-5 h-5 text-primary mb-2" />
              <h3 className="font-semibold text-sm">{f.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8">How it works</h2>
          <ol className="space-y-4">
            {[
              { n: 1, t: 'Create your planner account', d: 'Sign up with your brand name, email and phone. Takes under a minute.' },
              { n: 2, t: 'Get admin-verified', d: 'Our team reviews your profile within 24 hours and unlocks event publishing.' },
              { n: 3, t: 'List your event', d: 'Add ticket types, pricing, capacity, banner & venue. We publish it on the Fast Calories app.' },
              { n: 4, t: 'Sell & track', d: 'Customers pay online with cards, transfer or wallet. Watch sales in real-time.' },
              { n: 5, t: 'Withdraw to your bank', d: 'Funds clear after a short hold (default 48h). Request payout anytime — OTP-secured.' },
            ].map((s) => (
              <li key={s.n} className="flex gap-4 bg-card border border-border rounded-xl p-4">
                <div className="w-9 h-9 shrink-0 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center">{s.n}</div>
                <div>
                  <h3 className="font-semibold">{s.t}</h3>
                  <p className="text-sm text-muted-foreground">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-4 py-12 bg-secondary/30 border-y border-border">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h2 className="text-2xl font-bold">Simple, honest pricing</h2>
          <div className="bg-card border border-border rounded-2xl p-6 text-left">
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-5xl font-extrabold text-primary">5%</span>
              <span className="text-muted-foreground">per ticket sold</span>
            </div>
            <ul className="space-y-2 mt-5">
              {[
                'No monthly fee, no setup cost',
                'Free event listing on Fast Calories app',
                'Free ticket check-in app',
                'Paystack processing included in the 5%',
                'Withdrawals to any Nigerian bank account',
              ].map((b) => (
                <li key={b} className="flex items-center gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-emerald-600" />{b}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-16">
        <div className="max-w-3xl mx-auto bg-primary text-primary-foreground rounded-2xl p-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold">Ready to sell your next event?</h2>
          <p className="mt-2 opacity-90">Set up your organizer profile in minutes. Approval is fast.</p>
          <Link to="/organizer/auth" className="inline-flex items-center gap-2 mt-5 px-6 py-3 rounded-lg bg-white text-primary font-semibold">
            Create my planner account <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <footer className="px-4 py-6 border-t border-border text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Fast Calories. Events powered by Paystack.
      </footer>
    </div>
  );
}
