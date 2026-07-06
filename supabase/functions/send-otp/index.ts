// Supabase Edge Function: send-otp
// Validates roll number against the student roster before allowing OTP dispatch

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, redirectTo } = await req.json()
    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const emailTrim = email.trim().toLowerCase()

    // 1. Validate email domain
    const parts = emailTrim.split('@')
    if (parts.length !== 2 || parts[1] !== 'nituk.ac.in') {
      return new Response(
        JSON.stringify({ error: "Only @nituk.ac.in email addresses are eligible." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Validate local part (must start with bt24cse followed by digits)
    const localPart = parts[0]
    if (!/^bt24cse\d+$/i.test(localPart)) {
      return new Response(
        JSON.stringify({ error: "This email does not belong to the BT24 CSE batch." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const rollNo = localPart.toUpperCase()

    // 3. Connect to Supabase using system environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ""
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ""
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server Configuration Error: Supabase credentials not found." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 4. Verify that this roll number exists on the student electoral roll
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('roll_no')
      .eq('roll_no', rollNo)
      .maybeSingle()

    if (studentError) {
      return new Response(
        JSON.stringify({ error: "Database error during roll validation: " + studentError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!student) {
      return new Response(
        JSON.stringify({ error: "This roll number isn't on the electoral roll for this election. Contact your SPR if this looks wrong." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. Check if it is a test email address
    const testEmails = [
      'bt24cse060@nituk.ac.in',
      'bt24cse061@nituk.ac.in',
      'bt24cse062@nituk.ac.in',
      'bt24cse063@nituk.ac.in',
      'bt24cse065@nituk.ac.in'
    ];
    const isTestEmail = testEmails.includes(emailTrim);

    if (isTestEmail) {
      return new Response(
        JSON.stringify({ message: "Test account detected. Enter 123456 as verification code." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Trigger the Supabase Authentication OTP flow
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: emailTrim,
      options: {
        shouldCreateUser: true, // User will be created in auth.users if not already exists
        emailRedirectTo: redirectTo || "http://localhost:5173"
      }
    })

    if (otpError) {
      return new Response(
        JSON.stringify({ error: "Failed to dispatch OTP: " + otpError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Success response
    return new Response(
      JSON.stringify({ message: "A 6-digit OTP code has been sent to your email." }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "An unexpected error occurred." }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
