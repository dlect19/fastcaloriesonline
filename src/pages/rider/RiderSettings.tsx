import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { RiderFloatingWidget } from '@/components/rider/RiderFloatingWidget';
import { EmailVerificationOTP } from '@/components/rider/EmailVerificationOTP';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, MapPin, Volume2, Smartphone, ShieldCheck, Mail, CheckCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSound } from '@/hooks/useNotificationSound';

const VEHICLE_TYPES = [
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'tricycle', label: 'Tricycle (Keke)' },
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
];

export default function RiderSettings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { soundEnabled, setSoundEnabled, playNotification } = useNotificationSound();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isSetupMode = searchParams.get('setup') === 'true';
  const [isOnline, setIsOnline] = useState(false);
  const [floatModeEnabled, setFloatModeEnabled] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [userEmail, setUserEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [showEmailVerification, setShowEmailVerification] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  
  // Work location state
  const [preferredCity, setPreferredCity] = useState('');
  const [preferredState, setPreferredState] = useState('');
  const [workRadius, setWorkRadius] = useState(10);
  const [locatingGPS, setLocatingGPS] = useState(false);

  useEffect(() => {
    checkAuth();
    const savedFloatMode = localStorage.getItem('rider_float_mode');
    setFloatModeEnabled(savedFloatMode === 'true');
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

    setUserId(user.id);
    setUserEmail(user.email || '');


    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    const { data: riderData } = await supabase
      .from('rider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    setProfile(profileData);
    setRiderProfile(riderData);
    setFullName(profileData?.full_name || '');
    setPhone(profileData?.phone || '');
    setVehicleType(riderData?.vehicle_type || '');
    setVehiclePlate(riderData?.vehicle_plate || '');
    setPreferredCity(riderData?.preferred_city || '');
    setPreferredState(riderData?.preferred_state || '');
    setWorkRadius(riderData?.work_radius_km || 10);
    setIsOnline(riderData?.is_online || false);
    setLoading(false);
  };

  const handleSave = async () => {
    // Validate required fields
    if (!vehicleType) {
      toast({ title: 'Please select a vehicle type', variant: 'destructive' });
      return;
    }

    // Require plate number for non-bicycle vehicles
    if (vehicleType !== 'bicycle' && !vehiclePlate) {
      toast({ title: 'Please enter your vehicle plate number', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('profiles')
        .update({ full_name: fullName, phone })
        .eq('user_id', user.id);

      // Clear plate number for bicycles
      const plateToSave = vehicleType === 'bicycle' ? '' : vehiclePlate;

      await supabase
        .from('rider_profiles')
        .update({ 
          vehicle_type: vehicleType, 
          vehicle_plate: plateToSave,
          preferred_city: preferredCity,
          preferred_state: preferredState,
          work_radius_km: workRadius,
        })
        .eq('user_id', user.id);

      toast({ title: 'Settings saved successfully' });

      // If in setup mode and all required fields are filled, redirect to dashboard
      if (isSetupMode && vehicleType) {
        navigate('/rider/dashboard');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({ title: 'Failed to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) {
      toast({ title: 'Geolocation not supported', variant: 'destructive' });
      return;
    }

    setLocatingGPS(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        try {
          // Use geocoding to get city/state from coordinates
          const { data, error } = await supabase.functions.invoke('geocode-address', {
            body: { latitude, longitude, reverse: true }
          });
          
          if (data?.city) setPreferredCity(data.city);
          if (data?.state) setPreferredState(data.state);
          
          // Also save the coordinates
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase
              .from('rider_profiles')
              .update({ 
                preferred_latitude: latitude, 
                preferred_longitude: longitude 
              })
              .eq('user_id', user.id);
          }
          
          toast({ title: 'Location updated' });
        } catch (err) {
          console.error('Error reverse geocoding:', err);
          toast({ title: 'Could not determine location details', variant: 'destructive' });
        }
        
        setLocatingGPS(false);
      },
      (error) => {
        console.error('Geolocation error:', error);
        toast({ title: 'Failed to get location', variant: 'destructive' });
        setLocatingGPS(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const toggleOnline = async (online: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('rider_profiles')
      .update({ is_online: online })
      .eq('user_id', user.id);

    setIsOnline(online);
  };

  const handleTestSound = () => {
    playNotification();
  };

  const handleFloatModeToggle = (enabled: boolean) => {
    setFloatModeEnabled(enabled);
    localStorage.setItem('rider_float_mode', enabled.toString());
    toast({ 
      title: enabled ? 'Float mode enabled' : 'Float mode disabled',
      description: enabled ? 'A floating widget will appear for quick access' : '',
    });
  };

  const handleEmailVerified = async () => {
    // Update rider profile to mark email as verified
    await supabase
      .from('rider_profiles')
      .update({ is_email_verified: true })
      .eq('user_id', userId);
    
    setRiderProfile((prev: any) => ({ ...prev, is_email_verified: true }));
    setShowEmailVerification(false);
    toast({ title: 'Email verified successfully!' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showEmailVerification && userId && userEmail) {
    return (
      <EmailVerificationOTP 
        email={userEmail}
        userId={userId}
        platform="rider"
        onVerified={handleEmailVerified}
        onBack={() => setShowEmailVerification(false)}
      />
    );
  }

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">
          {isSetupMode ? 'Complete Your Profile' : 'Settings'}
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          {isSetupMode ? 'Please complete your profile to start receiving orders' : 'Manage your profile and preferences'}
        </p>
      </div>

      {isSetupMode && (
        <Alert className="mb-6 border-primary bg-primary/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            You must complete your vehicle information before you can receive delivery orders.
          </AlertDescription>
        </Alert>
      )}

      <div className="max-w-2xl space-y-4 md:space-y-6">
        {/* Personal Information */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6 pt-0">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Vehicle Information */}
        <Card className={isSetupMode && !vehicleType ? 'border-destructive' : ''}>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl">Vehicle Information</CardTitle>
            {isSetupMode && !vehicleType && (
              <CardDescription className="text-destructive">
                Please select your vehicle type to continue
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6 pt-0">
            <div className="space-y-2">
              <Label htmlFor="vehicleType">Vehicle Type *</Label>
              <Select value={vehicleType} onValueChange={setVehicleType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your vehicle type" />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehiclePlate">
                Plate Number {vehicleType !== 'bicycle' && '*'}
              </Label>
              <Input
                id="vehiclePlate"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder={vehicleType === 'bicycle' ? 'N/A for bicycles' : 'e.g., ABC-123-XY'}
                disabled={vehicleType === 'bicycle'}
              />
            </div>
          </CardContent>
        </Card>

        {/* Work Location */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Work Location
            </CardTitle>
            <CardDescription>
              Set your preferred delivery area to receive nearby orders
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="preferredCity">City</Label>
                <Input
                  id="preferredCity"
                  value={preferredCity}
                  onChange={(e) => setPreferredCity(e.target.value)}
                  placeholder="e.g., Lagos"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preferredState">State</Label>
                <Input
                  id="preferredState"
                  value={preferredState}
                  onChange={(e) => setPreferredState(e.target.value)}
                  placeholder="e.g., Lagos State"
                />
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Work Radius</Label>
                <span className="text-sm font-medium text-primary">{workRadius} km</span>
              </div>
              <Slider
                value={[workRadius]}
                onValueChange={(values) => setWorkRadius(values[0])}
                min={5}
                max={50}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                You'll receive orders from vendors within {workRadius}km of your preferred location
              </p>
            </div>

            <Button 
              variant="outline" 
              className="w-full"
              onClick={handleUseCurrentLocation}
              disabled={locatingGPS}
            >
              {locatingGPS ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <MapPin className="w-4 h-4 mr-2" />
              )}
              Use Current Location
            </Button>
          </CardContent>
        </Card>

        {/* App Settings */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              App Settings
            </CardTitle>
            <CardDescription>
              Configure app behavior and notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6 pt-0">
            {/* Float Mode Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm md:text-base">Float Mode</p>
                <p className="text-xs md:text-sm text-muted-foreground">Show floating widget for quick access</p>
              </div>
              <Switch checked={floatModeEnabled} onCheckedChange={handleFloatModeToggle} />
            </div>

            {/* Notification Sound */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm md:text-base flex items-center gap-2">
                  <Volume2 className="w-4 h-4" />
                  Notification Sound
                </p>
                <p className="text-xs md:text-sm text-muted-foreground">Play sound for new orders</p>
              </div>
              <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
            </div>
            {soundEnabled && (
              <Button variant="outline" size="sm" onClick={handleTestSound}>
                Test Sound
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Verification Status */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              Verification Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6 pt-0">
            {/* Email Verification */}
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${riderProfile?.is_email_verified ? 'bg-calorie-low' : 'bg-calorie-medium'}`} />
              <div className="flex-1">
                <p className="text-sm md:text-base flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email Verification
                </p>
                <p className="text-xs text-muted-foreground">
                  {riderProfile?.is_email_verified ? 'Verified' : 'Pending - Click to verify your email'}
                </p>
              </div>
              {!riderProfile?.is_email_verified && (
                <Button size="sm" variant="outline" onClick={() => setShowEmailVerification(true)}>
                  Verify Now
                </Button>
              )}
              {riderProfile?.is_email_verified && (
                <CheckCircle className="w-5 h-5 text-calorie-low" />
              )}
            </div>

            {/* NIN Verification */}
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${riderProfile?.nin_verified ? 'bg-calorie-low' : riderProfile?.nin_number ? 'bg-calorie-medium' : 'bg-destructive'}`} />
              <div className="flex-1">
                <p className="text-sm md:text-base flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  NIN Verification
                </p>
                <p className="text-xs text-muted-foreground">
                  {riderProfile?.nin_verified 
                    ? 'Verified' 
                    : riderProfile?.nin_number 
                      ? `Submitted: ${riderProfile.nin_number.slice(0, 3)}****${riderProfile.nin_number.slice(-4)} - Under review`
                      : 'Not submitted - Required to receive orders'}
                </p>
              </div>
            </div>

            {/* Account Verification */}
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${riderProfile?.is_verified ? 'bg-calorie-low' : 'bg-calorie-medium'}`} />
              <div className="flex-1">
                <p className="text-sm md:text-base">Account Status</p>
                <p className="text-xs text-muted-foreground">
                  {riderProfile?.is_verified 
                    ? 'Approved - You can receive deliveries' 
                    : 'Pending admin approval'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={saving} className="w-full md:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
      </div>

      {/* Floating Widget */}
      {floatModeEnabled && (
        <RiderFloatingWidget isOnline={isOnline} onToggleOnline={toggleOnline} />
      )}
    </RiderLayout>
  );
}
