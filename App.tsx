import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { TryOnScreen } from './src/screens/TryOnScreen';
import { ClosetScreen } from './src/screens/ClosetScreen';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="light" />
          <Tab.Navigator
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: colors.accent,
              tabBarInactiveTintColor: colors.textMuted,
              tabBarStyle: {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
            }}
          >
            <Tab.Screen name="Try On" component={TryOnScreen} />
            <Tab.Screen name="Closet" component={ClosetScreen} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
