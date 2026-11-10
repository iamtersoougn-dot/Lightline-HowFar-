import { useEffect, useState, useCallback, useRef } from 'react';

export interface HardwarePowerSensorState {
  isDevicePluggedIn: boolean;
  batteryPercentage: number;
  powerTransitionDetectedAt: string | null;
  dismissTransitionAlert: () => void;
  simulateChargerPlugIn: () => void;
}

export function useHardwarePowerSensor(
  onChargerConnectedCallback?: () => void
): HardwarePowerSensorState {
  const [isDevicePluggedIn, setIsDevicePluggedIn] = useState<boolean>(false);
  const [batteryPercentage, setBatteryPercentage] = useState<number>(82);
  const [powerTransitionDetectedAt, setPowerTransitionDetectedAt] = useState<string | null>(
    null
  );

  // Keep the latest callback in a ref so battery listeners subscribe once, not every render
  const callbackRef = useRef(onChargerConnectedCallback);
  useEffect(() => {
    callbackRef.current = onChargerConnectedCallback;
  }, [onChargerConnectedCallback]);

  const dismissTransitionAlert = useCallback(() => {
    setPowerTransitionDetectedAt(null);
  }, []);

  const simulateChargerPlugIn = useCallback(() => {
    setIsDevicePluggedIn(true);
    setPowerTransitionDetectedAt(new Date().toISOString());
    callbackRef.current?.();
  }, []);

  useEffect(() => {
    let batteryManager: any = null;
    let wasCharging = false;

    const handleChargingChange = () => {
      if (!batteryManager) return;
      const nowCharging = Boolean(batteryManager.charging);
      if (!wasCharging && nowCharging) {
        setPowerTransitionDetectedAt(new Date().toISOString());
        callbackRef.current?.();
      }
      wasCharging = nowCharging;
      setIsDevicePluggedIn(nowCharging);
    };

    const handleLevelChange = () => {
      if (!batteryManager) return;
      setBatteryPercentage(Math.round((batteryManager.level || 0.82) * 100));
    };

    if ('getBattery' in navigator && typeof (navigator as any).getBattery === 'function') {
      (navigator as any)
        .getBattery()
        .then((battery: any) => {
          batteryManager = battery;
          wasCharging = Boolean(battery.charging);
          setIsDevicePluggedIn(wasCharging);
          setBatteryPercentage(Math.round((battery.level || 0.82) * 100));

          battery.addEventListener('chargingchange', handleChargingChange);
          battery.addEventListener('levelchange', handleLevelChange);
        })
        .catch(() => {
          // Fallback gracefully if browser restricts Battery API
        });
    }

    return () => {
      if (batteryManager) {
        batteryManager.removeEventListener('chargingchange', handleChargingChange);
        batteryManager.removeEventListener('levelchange', handleLevelChange);
      }
    };
  }, []);

  return {
    isDevicePluggedIn,
    batteryPercentage,
    powerTransitionDetectedAt,
    dismissTransitionAlert,
    simulateChargerPlugIn
  };
}
