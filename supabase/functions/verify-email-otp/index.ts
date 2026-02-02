import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerifyOTPRequest {
  email: string;
  otp?: string;
  otpCode?: string; // Alternative field name for compatibility
  userId?: string;
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

    const body: VerifyOTPRequest = await req.json();
    const email = body.email;
    const otp = body.otp || body.otpCode; // Support both field names
    const userId = body.userId;
    const platform = body.platform;

    if (!email || !otp) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email and OTP are required' }),
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
        JSON.stringify({ success: false, verified: false, error: 'Invalid or expired code' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark OTP as used
    await supabase
      .from('email_verification_otps')
      .update({ used: true })
      .eq('id', otpRecord.id);

    // Update the appropriate profile based on platform
    if (platform === 'rider' && userId) {
      const { error: updateError } = await supabase
        .from('rider_profiles')
        .update({ is_email_verified: true })
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error updating rider profile:', updateError);
      }
    } else if (platform === 'delivery_company') {
      // For delivery company, the update is done client-side after receiving success
      // because we need the company_id which isn't passed here
      console.log('Delivery company email verified via OTP');
    }

    // Update auth user metadata (optional)
    if (userId) {
      try {
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: { email_verified_at: new Date().toISOString() }
        });
      } catch (authError) {
        console.log('Could not update auth metadata:', authError);
      }
    }

    console.log(`Email verified successfully for ${email}`);

    return new Response(
      JSON.stringify({ success: true, verified: true, message: 'Email verified successfully' }),
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
