import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

// Vibrant brand green for CTA
const BRAND_GREEN = '#16a34a';

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  message?: string;
}

export default function LoginModal({ open, onOpenChange, title, message }: LoginModalProps) {
  const { signInWithGoogle } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const returnPath = encodeURIComponent(location.pathname + location.search);

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      await signInWithGoogle();
    } catch (error: any) {
      toast({
        title: 'Sign in failed',
        description: error.message || 'Failed to sign in with Google',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-border bg-card dark:bg-black shadow-2xl">
        <DialogHeader>
          <div className="flex flex-col items-center gap-2 mb-3">
            {/* Padlock with heart */}
            <svg className="w-14 h-14" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="12" y="28" width="40" height="30" rx="4" className="fill-neutral-200 dark:fill-[#222]" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
              <path d="M20 28V20C20 13.4 25.4 8 32 8C38.6 8 44 13.4 44 20V22" className="stroke-neutral-400 dark:stroke-[#666]" strokeWidth="3" strokeLinecap="round" />
              <path d="M32 38C29.8 36 26 38.5 26 41.5C26 44 28.5 46 32 49C35.5 46 38 44 38 41.5C38 38.5 34.2 36 32 38Z" fill="#d4a030" />
            </svg>
          </div>
          <DialogTitle className="text-center text-2xl font-display text-foreground">
            {title || 'Welcome to London Strategic Edge'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <p className="text-sm text-muted-foreground text-center leading-relaxed">
            {message || 'Sign in to save your layouts and sync across devices, completely free.'}
          </p>

          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full h-12 flex items-center justify-center gap-3 rounded-lg text-[15px] font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: '#ffffff',
              color: '#3c4043',
              border: '1px solid #dadce0',
              boxShadow: '0 1px 3px 0 rgba(60,64,67,0.08), 0 1px 2px -1px rgba(60,64,67,0.06)',
              transition: 'all 0.2s ease',
              fontFamily: "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              letterSpacing: '0.01em',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(60,64,67,0.15), 0 2px 4px -1px rgba(60,64,67,0.10)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(60,64,67,0.08), 0 1px 2px -1px rgba(60,64,67,0.06)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {isLoading ? 'Signing in...' : 'Continue with Google'}
          </button>

          <Button
            onClick={() => { onOpenChange(false); navigate(`/auth?mode=signup&returnTo=${returnPath}`); }}
            className="w-full h-12 text-base font-semibold bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
            size="lg"
          >
            Create an Account
          </Button>

          <p className="text-xs text-muted-foreground text-center px-8">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>

          <p className="text-xs text-center">
            <span className="text-muted-foreground">Already have an account? </span>
            <button
              onClick={() => { onOpenChange(false); navigate(`/auth?mode=signin&returnTo=${returnPath}`); }}
              className="font-semibold text-foreground hover:underline"
            >
              Sign in
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
