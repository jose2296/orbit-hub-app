import "expo-router/entry";
import { Platform } from "react-native";

// The widgets only exist on Android, and their task handler runs headless: Android starts the JS
// runtime for a widget event without opening the app, so the handler has to be registered here, at
// the entry point, and not inside a screen.
if (Platform.OS === "android") {
  const { registerWidgetTaskHandler } = require("react-native-android-widget");
  const { widgetTaskHandler } = require("./src/widgets/task-handler");
  registerWidgetTaskHandler(widgetTaskHandler);
}
