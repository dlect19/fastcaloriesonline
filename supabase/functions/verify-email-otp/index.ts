import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerifyOTPRequest {
  email: string;
  otp: string;
  userId: string;
  platform: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { email, otp, userId, platform }: VerifyOTPRequest = await req.json();

    if (!email || !otp || !userId) {
      return new Response(
        JSON.stringify({ error: 'Email, OTP, and user ID are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Verifying email OTP for ${email} on platform ${platform}`);

    // Find valid OTP
    const now = new Date().toISOString();
    const { data: otpRecord, error: otpError } = await supabase
      .from('email_verification_otps')
      .select('*')
      .eq('email', email)
      .eq('otp_code', otp)
      .eq('used', false)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError) {
      console.error('Error fetching OTP:', otpError);
      throw otpError;
    }

    if (!otpRecord) {
      console.log('Invalid or expired OTP');
      return new Response(
        JSON.stringify({ verified: false, error: 'Invalid or expired code' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark OTP as used
    await supabase
      .from('email_verification_otps')
      .update({ used: true })
      .eq('id', otpRecord.id);

    // Update rider profile to mark email as verified
    if (platform === 'rider') {
      const { error: updateError } = await supabase
        .from('rider_profiles')
        .update({ is_email_verified: true })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error updating rider profile:', updateError);
      }
    }

    // Update auth user metadata (optional)
    try {
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: { email_verified_at: new Date().toISOString() }
      });
    } catch (authError) {
      console.log('Could not update auth metadata:', authError);
    }

    console.log(`Email verified successfully for ${email}`);

    return new Response(
      JSON.stringify({ verified: true, message: 'Email verified successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error verifying email OTP:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to verify code' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
