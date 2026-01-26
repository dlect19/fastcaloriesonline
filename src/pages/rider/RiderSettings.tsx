import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Loader2, Save, MapPin, Volume2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSound } from '@/hooks/useNotificationSound';

export default function RiderSettings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { soundEnabled, setSoundEnabled, playNotification } = useNotificationSound();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [riderProfile, setRiderProfile] = useState<any>(null);

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
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

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
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('profiles')
        .update({ full_name: fullName, phone })
        .eq('user_id', user.id);

      await supabase
        .from('rider_profiles')
        .update({ 
          vehicle_type: vehicleType, 
          vehicle_plate: vehiclePlate,
          preferred_city: preferredCity,
          preferred_state: preferredState,
          work_radius_km: workRadius,
        })
        .eq('user_id', user.id);

      toast({ title: 'Settings saved successfully' });
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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground text-sm md:text-base">Manage your profile and preferences</p>
      </div>

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
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl">Vehicle Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6 pt-0">
            <div className="space-y-2">
              <Label htmlFor="vehicleType">Vehicle Type</Label>
              <Input
                id="vehicleType"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
                placeholder="e.g., Motorcycle, Bicycle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehiclePlate">Plate Number</Label>
              <Input
                id="vehiclePlate"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="e.g., ABC-123-XY"
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

        {/* Notification Settings */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-lg md:text-xl flex items-center gap-2">
              <Volume2 className="w-5 h-5" />
              Notifications
            </CardTitle>
            <CardDescription>
              Configure how you receive order notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6 pt-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm md:text-base">Notification Sound</p>
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
            <CardTitle className="text-lg md:text-xl">Verification Status</CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6 pt-0">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${riderProfile?.is_verified ? 'bg-calorie-low' : 'bg-calorie-medium'}`} />
              <span className="text-sm md:text-base">{riderProfile?.is_verified ? 'Verified' : 'Pending Verification'}</span>
            </div>
            {!riderProfile?.is_verified && (
              <p className="text-xs md:text-sm text-muted-foreground mt-2">
                Your account is under review. You'll be notified once verified.
              </p>
            )}
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={saving} className="w-full md:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
      </div>
    </RiderLayout>
  );
}
