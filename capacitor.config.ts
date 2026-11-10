import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.theaffilmtiser.lightline',
  appName: 'Lightline',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Allows http:// to a dev backend on your LAN. Remove for production builds.
    cleartext: true
  },
  plugins: {
    LocalNotifications: {
      // Add res/drawable/ic_stat_bolt.png and a custom sound in the android project, then
      // set smallIcon / sound here. Leaving them unset uses the system defaults.
      iconColor: '#10B981'
    }
  }
};

export default config;
