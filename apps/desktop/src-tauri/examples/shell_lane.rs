// The Linux shell lane (#208): the real shell window, its strip and one tab under Xvfb, checked by
// `maude_desktop_lib::shell_lane` (where GTK put each webview + pixel samples). CI:
// `.github/workflows/linux-shell-lane.yml`. Anywhere but Linux it prints a line and exits 0.
fn main() {
    std::process::exit(maude_desktop_lib::shell_lane::main(tauri::generate_context!()));
}
