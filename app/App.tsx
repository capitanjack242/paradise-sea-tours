import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet } from "react-native";
import BookScreen from "./src/screens/BookScreen";
import { colors } from "./src/lib/theme";

export default function App() {
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <BookScreen />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
});
