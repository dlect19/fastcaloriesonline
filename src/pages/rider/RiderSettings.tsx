import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { RiderFloatingWidget } from '@/components/rider/RiderFloatingWidget';
import { EmailVerificationOTP } from '@/components/rider/EmailVerificationOTP';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, MapPin, Volume2, Smartphone, ShieldCheck, Mail, CheckCircle, AlertTriangle, RefreshCw, Upload, FileImage } from 'lucide-react';
import { DeleteAccountDialog } from '@/components/shared/DeleteAccountDialog';
import { CommissionDisplay } from '@/components/shared/CommissionDisplay';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { useVehicleTypeConfigs } from '@/hooks/useVehicleTypeConfigs';
import { sanitizePhoneInput, isValidNgPhone, PHONE_ERROR_MESSAGE, PHONE_LENGTH } from '@/lib/phoneValidation';

export default function RiderSettings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { soundEnabled, setSoundEnabled, playNotification } = useNotificationSound();
  const { configs: vehicleConfigs, getConfigForVehicle } = useVehicleTypeConfigs();
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
  
  // NIN state
  const [ninNumber, setNinNumber] = useState('');
  const [savingNin, setSavingNin] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  useEffect(() => {
    // Prefill input if we already have a submitted NIN (e.g. under review)
    if (riderProfile?.nin_number) {
      setNinNumber(riderProfile.nin_number);
    }
  }, [riderProfile?.nin_number]);

  // Clamp work radius to the admin-configured max for the selected vehicle type
  useEffect(() => {
    const cfg = getConfigForVehicle(vehicleType);
    if (!cfg) return;
    const max = cfg.max_delivery_distance_km;
    setWorkRadius((prev) => (prev > max ? max : prev));
  }, [vehicleType, vehicleConfigs]);

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

    // Fetch the most recent rider profile row. If none exists (common on first login),
    // create a default one so subsequent updates (city/state/radius) actually persist.
    const { data: riderData, error: riderFetchError } = await supabase
      .from('rider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (riderFetchError) {
      console.error('Error fetching rider profile:', riderFetchError);
    }

    let effectiveRiderData = riderData;
    if (!effectiveRiderData) {
      const { data: createdRows, error: createError } = await supabase
        .from('rider_profiles')
        .insert({ user_id: user.id })
        .select('*');

      if (createError) {
        console.error('Error creating rider profile:', createError);
      } else {
        effectiveRiderData = createdRows?.[0] ?? null;
      }
    }

    setProfile(profileData);
    setRiderProfile(effectiveRiderData);
    setFullName(profileData?.full_name || '');
    setPhone(profileData?.phone || '');
    setVehicleType(effectiveRiderData?.vehicle_type || '');
    setVehiclePlate(effectiveRiderData?.vehicle_plate || '');
    setPreferredCity(effectiveRiderData?.preferred_city || '');
    setPreferredState(effectiveRiderData?.preferred_state || '');
    setWorkRadius(Number(effectiveRiderData?.work_radius_km ?? 10));
    setIsOnline(Boolean(effectiveRiderData?.is_online));
    setLoading(false);
  };

  const handleSave = async () => {
    // Validate required fields
    if (!vehicleType) {
      toast({ title: 'Please select a vehicle type', variant: 'destructive' });
      return;
    }

    if (!isValidNgPhone(phone)) {
      toast({ title: 'Invalid phone number', description: PHONE_ERROR_MESSAGE, variant: 'destructive' });
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

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName, phone })
        .eq('user_id', user.id);

      if (profileError) {
        console.error('Error updating profile:', profileError);
        toast({ title: 'Failed to save profile', variant: 'destructive' });
        setSaving(false);
        return;
      }

      // Clear plate number for bicycles
      const plateToSave = vehicleType === 'bicycle' ? '' : vehiclePlate;

      const { error: riderError } = await supabase
        .from('rider_profiles')
        .update({ 
          vehicle_type: vehicleType, 
          vehicle_plate: plateToSave,
          preferred_city: preferredCity,
          preferred_state: preferredState,
          work_radius_km: workRadius,
        })
        .eq('user_id', user.id);

      if (riderError) {
        console.error('Error updating rider profile:', riderError);
        toast({ title: 'Failed to save rider settings', description: riderError.message, variant: 'destructive' });
        setSaving(false);
        return;
      }

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

  const validateNIN = (nin: string) => {
    return /^\d{11}$/.test(nin);
  };

  const handleSubmitNin = async () => {
    if (!validateNIN(ninNumber)) {
      toast({
        title: 'Invalid NIN',
        description: 'Please enter a valid 11-digit National Identification Number',
        variant: 'destructive',
      });
      return;
    }

    setSavingNin(true);
    try {
      const { error } = await supabase
        .from('rider_profiles')
        .update({
          nin_number: ninNumber,
          nin_submitted_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (error) throw error;

      setRiderProfile((prev: any) => ({ 
        ...prev, 
        nin_number: ninNumber,
        nin_submitted_at: new Date().toISOString(),
      }));
      toast({ title: 'NIN submitted successfully!', description: 'Your NIN will be verified by admin.' });
    } catch (error: any) {
      console.error('Error submitting NIN:', error);
      toast({ title: 'Failed to submit NIN', description: error.message, variant: 'destructive' });
    } finally {
      setSavingNin(false);
    }
  };

  const handleUploadNinDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB', variant: 'destructive' });
      return;
    }

    setUploadingDoc(true);
    try {
      const ext = file.name.split('.').pop();
      const filePath = `${userId}/nin-document.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('rider-documents')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('rider-documents')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('rider_profiles')
        .update({ id_document_url: publicUrl })
        .eq('user_id', userId);

      if (updateError) throw updateError;

      setRiderProfile((prev: any) => ({ ...prev, id_document_url: publicUrl }));
      toast({ title: 'NIN document uploaded successfully!' });
    } catch (error: any) {
      console.error('Error uploading NIN document:', error);
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    } finally {
      setUploadingDoc(false);
    }
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

      {/* NIN Submission (always visible when missing) */}
      {!riderProfile?.nin_number && (
        <div className="max-w-2xl mb-4 md:mb-6">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                Submit your NIN
              </CardTitle>
              <CardDescription>
                Required for security verification before you can receive delivery requests.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 md:p-6 pt-0">
              <div className="space-y-2">
                <Label htmlFor="nin-number-top">National Identification Number (NIN)</Label>
                <Input
                  id="nin-number-top"
                  inputMode="numeric"
                  value={ninNumber}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 11);
                    setNinNumber(value);
                  }}
                  placeholder="Enter 11-digit NIN"
                  maxLength={11}
                />
              </div>

              {/* NIN Document Upload */}
              <div className="space-y-2">
                <Label>Upload NIN Slip/Card (Photo)</Label>
                <div className="flex items-center gap-3">
                  <label className="flex-1 cursor-pointer">
                    <div className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                      {uploadingDoc ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-sm text-muted-foreground">
                        {riderProfile?.id_document_url ? 'Replace document' : 'Upload NIN slip/card'}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleUploadNinDocument}
                      disabled={uploadingDoc}
                    />
                  </label>
                  {riderProfile?.id_document_url && (
                    <a href={riderProfile.id_document_url} target="_blank" rel="noopener noreferrer">
                      <Badge variant="outline" className="gap-1">
                        <FileImage className="w-3 h-3" />
                        View
                      </Badge>
                    </a>
                  )}
                </div>
              </div>

              <Button
                onClick={handleSubmitNin}
                disabled={savingNin || ninNumber.length !== 11}
                className="w-full"
              >
                {savingNin ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-2" />
                )}
                Submit NIN for Verification
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NIN Document Upload for riders who already submitted NIN but no document */}
      {riderProfile?.nin_number && !riderProfile?.id_document_url && (
        <div className="max-w-2xl mb-4 md:mb-6">
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                <FileImage className="w-5 h-5" />
                Upload NIN Document
              </CardTitle>
              <CardDescription>
                Upload a photo of your NIN slip or card to speed up verification.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              <label className="cursor-pointer">
                <div className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                  {uploadingDoc ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className="text-sm text-muted-foreground">
                    Click to upload NIN slip/card photo
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUploadNinDocument}
                  disabled={uploadingDoc}
                />
              </label>
            </CardContent>
          </Card>
        </div>
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
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
                maxLength={PHONE_LENGTH}
                pattern="\d{11}"
                placeholder="08012345678"
                title={PHONE_ERROR_MESSAGE}
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
                  {vehicleConfigs.filter(c => c.is_active).map((type) => (
                    <SelectItem key={type.vehicle_type} value={type.vehicle_type}>
                      {type.display_name} (max {type.max_delivery_distance_km}km)
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
              {(() => {
                const vehicleConfig = getConfigForVehicle(vehicleType);
                const maxAllowed = vehicleConfig ? vehicleConfig.max_delivery_distance_km : 50;
                return (
                  <>
                    <Slider
                      value={[Math.min(workRadius, maxAllowed)]}
                      onValueChange={(values) => setWorkRadius(values[0])}
                      min={5}
                      max={maxAllowed}
                      step={5}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      You'll receive orders from vendors within {workRadius}km of your preferred location
                      {vehicleConfig && (
                        <span className="block text-xs mt-1">
                          Max allowed for {vehicleConfig.display_name}: <strong>{maxAllowed}km</strong>
                        </span>
                      )}
                    </p>
                  </>
                );
              })()}
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

            {/* Check for Updates */}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm md:text-base flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    App Updates
                  </p>
                  <p className="text-xs md:text-sm text-muted-foreground">Check if a newer version is available</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                      navigator.serviceWorker.getRegistration().then(reg => {
                        if (reg) {
                          reg.update().then(() => {
                            toast({ title: 'Checking for updates...', description: 'If an update is found, you\'ll be prompted to refresh.' });
                          });
                        } else {
                          toast({ title: 'No service worker found', description: 'Try reloading the page.', variant: 'destructive' });
                        }
                      });
                    } else {
                      window.location.reload();
                    }
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Check Now
                </Button>
              </div>
            </div>
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
              {riderProfile?.nin_verified && (
                <CheckCircle className="w-5 h-5 text-calorie-low" />
              )}
            </div>

            {/* NIN Submission Form - Show only if not submitted */}
            {/* NIN submission happens in the dedicated card above (kept out of this list for clarity) */}

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

        {/* Delete Account */}
        {userId && userEmail && (
          <Card className="border-destructive/30 mt-6">
            <CardContent className="p-4 md:p-6">
              <h3 className="text-sm font-medium text-destructive mb-2">Danger Zone</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Permanently delete your rider account and all associated data.
              </p>
              <DeleteAccountDialog
                userId={userId}
                userEmail={userEmail}
                onDeleted={() => navigate('/rider/auth')}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Floating Widget */}
      {floatModeEnabled && (
        <RiderFloatingWidget isOnline={isOnline} onToggleOnline={toggleOnline} />
      )}
    </RiderLayout>
  );
}
