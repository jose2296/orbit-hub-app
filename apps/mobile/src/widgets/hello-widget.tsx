import { FlexWidget, TextWidget } from "react-native-android-widget";

/** The smallest widget there is: proves the registration, the handler and the render. */
export function HelloWidget() {
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0B1020",
        borderRadius: 16,
      }}
    >
      <TextWidget text="OrbitHub" style={{ fontSize: 18, color: "#FFFFFF" }} />
    </FlexWidget>
  );
}
