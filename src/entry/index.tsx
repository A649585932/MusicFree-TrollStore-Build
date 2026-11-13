import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import bootstrap from "./bootstrap/bootstrap";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Dialogs from "@/components/dialogs";
import Panels from "@/components/panels";
import PageBackground from "@/components/base/pageBackground";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Debug from "@/components/debug";
import { PortalHost } from "@/components/base/portal";
import globalStyle from "@/constants/globalStyle";
import Theme from "@/core/theme";
import { BootstrapComponent } from "./bootstrap/BootstrapComponent";
import { ToastBaseComponent } from "@/components/base/toast";
import { Platform, StatusBar } from "react-native";
import { ReduceMotion, ReducedMotionConfig } from "react-native-reanimated";
import { routes } from "@/core/router/routes.tsx";
import ErrorBoundary from "@/components/errorBoundary";

/**
 * 字体颜色
 */

/**
 * StatusBar.setBackgroundColor / setTranslucent 只存在于 Android 实现，
 * iOS 的 StatusBar 模块里没有这两个方法。原代码在模块顶层同步调用，
 * iOS 上会抛 TypeError: StatusBar.setBackgroundColor is not a function，
 * 导致 JS Bundle 初始化失败、启动白屏/秒退。必须按平台守卫。
 */
if (Platform.OS === "android") {
    StatusBar.setBackgroundColor("transparent");
    StatusBar.setTranslucent(true);
}

bootstrap();
const Stack = createNativeStackNavigator<any>();

export default function Pages() {
    const theme = Theme.useTheme();

    return (
        <ErrorBoundary>
            <BootstrapComponent />
            <ReducedMotionConfig mode={ReduceMotion.Never} />
            <GestureHandlerRootView style={globalStyle.flex1}>
                <SafeAreaProvider>
                    <NavigationContainer theme={theme}>
                        <PageBackground />
                        <Stack.Navigator
                            initialRouteName={routes[0].path}
                            screenOptions={{
                                headerShown: false,
                                // iOS 默认的原生 push 动画比固定 slide_from_right 更跟手，
                                // 且 animationDuration 在 iOS 原生栈上会被忽略，
                                // 之前写死 100ms 反而让 Android 也显得生硬。
                                animation:
                                    Platform.OS === "ios"
                                        ? "default"
                                        : "slide_from_right",
                                animationDuration:
                                    Platform.OS === "android" ? 180 : undefined,
                                // 跟手返回手势（iOS 边缘滑返）
                                gestureEnabled: Platform.OS === "ios",
                                fullScreenGestureEnabled:
                                    Platform.OS === "ios",
                                contentStyle: {
                                    backgroundColor: "transparent",
                                },
                            }}>
                            {routes.map(route => (
                                <Stack.Screen
                                    key={route.path}
                                    name={route.path}
                                    component={route.component}
                                />
                            ))}
                        </Stack.Navigator>                        
                        <Panels />
                        <Dialogs />
                        <Debug />
                        <ToastBaseComponent />
                        <PortalHost />
                    </NavigationContainer>
                </SafeAreaProvider>
            </GestureHandlerRootView>
        </ErrorBoundary>
    );
}
