// shell_lane.rs — the Linux shell lane's harness (#208, debug builds only).
//
// `examples/shell_lane.rs` runs it under Xvfb in CI (`.github/workflows/linux-shell-lane.yml`). It opens the
// REAL shell — `tabs::ensure_shell` (the strip) and `tabs::add_tab` (one tab, labelled `home`) — paints the
// strip green and the tab magenta, and checks three states: as opened, after a resize, and with the tab
// overview open. Each check reads where GTK put the two webviews (their allocations in the window's GtkBox)
// and samples the window's pixels; `judge` turns that into problems. #208 was the strip taking the top half
// of the window: its allocation was half the height and the pixel a quarter of the way down was not the tab.
//
// Nothing here reaches a project, a sidecar, the keychain or the network: the app-local pages only, and the
// pictures are written to `$MAUDE_SHELL_LANE_OUT` (default `shell-lane/`).

use crate::tabs::STRIP_H;

/// The strip's paint.
pub const GREEN: (u8, u8, u8) = (0, 255, 0);
/// The tab's paint.
pub const MAGENTA: (u8, u8, u8) = (255, 0, 255);
/// How far a sampled channel may be from the paint.
const TOLERANCE: i32 = 24;

/// A rect in the window, logical px: x, y, width, height.
pub type Area = (i32, i32, i32, i32);

/// What one check saw.
pub struct Seen<'a> {
    /// The window's content box (the GtkBox every child sits in).
    pub area: Area,
    /// The strip's allocation.
    pub strip: Area,
    /// The shown tab's allocation; `None` while the overview hides it.
    pub tab: Option<Area>,
    /// The tab overview is open.
    pub overview: bool,
    /// The colour of the window's pixel at (x, y), `None` outside the picture.
    pub px: &'a dyn Fn(i32, i32) -> Option<(u8, u8, u8)>,
}

fn near(got: Option<(u8, u8, u8)>, want: (u8, u8, u8)) -> bool {
    got.is_some_and(|(r, g, b)| {
        [(r, want.0), (g, want.1), (b, want.2)]
            .iter()
            .all(|(a, b)| (i32::from(*a) - i32::from(*b)).abs() <= TOLERANCE)
    })
}

/// Pure: what is wrong with what the lane saw — empty when the strip is a 38 px band at the top of the
/// content box and the shown tab fills everything below it (or, with the overview open, the strip fills it all).
pub fn judge(seen: &Seen) -> Vec<String> {
    let mut problems = Vec::new();
    let (ax, ay, aw, ah) = seen.area;
    let cx = ax + aw / 2;
    let mut colour = |what: &str, y: i32, want: (u8, u8, u8)| {
        let got = (seen.px)(cx, y);
        if !near(got, want) {
            problems.push(format!("{what} at ({cx}, {y}) is {got:?}, not {want:?}"));
        }
    };
    if seen.overview {
        colour("the overview strip, a quarter down", ay + ah / 4, GREEN);
        colour("the overview strip, near the bottom", ay + ah - 10, GREEN);
    } else {
        colour("the strip", ay + STRIP_H as i32 / 2, GREEN);
        colour("the tab just below the strip", ay + STRIP_H as i32 + 10, MAGENTA);
        colour("the tab a quarter down", ay + ah / 4, MAGENTA);
        colour("the tab near the bottom", ay + ah - 10, MAGENTA);
    }
    let want_strip = if seen.overview { seen.area } else { (ax, ay, aw, STRIP_H as i32) };
    if seen.strip != want_strip {
        problems.push(format!("the strip is at {:?}, not {want_strip:?}", seen.strip));
    }
    match (seen.overview, seen.tab) {
        (false, Some(tab)) => {
            let want = (ax, ay + STRIP_H as i32, aw, ah - STRIP_H as i32);
            if tab != want {
                problems.push(format!("the tab is at {tab:?}, not {want:?}"));
            }
        }
        (false, None) => problems.push("no tab is shown".into()),
        (true, Some(tab)) => problems.push(format!("the overview left the tab shown at {tab:?}")),
        (true, None) => {}
    }
    problems
}

/// Repaint the page every 100 ms (the strip and the splash keep rendering): one colour, nothing on it.
/// Idempotent — `check` sends it on every look, so a page that loaded (or navigated) late is painted too.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn paint_js(rgb: (u8, u8, u8)) -> String {
    let c = format!("rgb({},{},{})", rgb.0, rgb.1, rgb.2);
    format!(
        "if(!window.__shellLane){{window.__shellLane=1;setInterval(function(){{\
         var d=document.documentElement;d.style.setProperty('background','{c}','important');\
         if(document.body){{document.body.style.setProperty('background','{c}','important');\
         for(var k of document.body.children)k.style.setProperty('visibility','hidden','important');}}}},100);}}"
    )
}

/// Run the lane; the process exit code (0 = every check passed).
#[cfg(target_os = "linux")]
pub fn main(ctx: tauri::Context<tauri::Wry>) -> i32 {
    linux::run(ctx)
}

/// Run the lane; Linux only — elsewhere `set_bounds` places the children and there is nothing to check.
#[cfg(not(target_os = "linux"))]
pub fn main(ctx: tauri::Context<tauri::Wry>) -> i32 {
    let _ = ctx;
    eprintln!("shell_lane: Linux only");
    0
}

#[cfg(target_os = "linux")]
mod linux {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use gtk::prelude::*;
    use tauri::{AppHandle, LogicalSize, Manager};

    use super::{judge, paint_js, Area, Seen};
    use crate::tabs::{self, SHELL_LABEL, STRIP_LABEL};
    use crate::windows::HOME_LABEL;

    fn paint(app: &AppHandle) {
        for (label, rgb) in [(STRIP_LABEL, super::GREEN), (HOME_LABEL, super::MAGENTA)] {
            if let Some(wv) = app.get_webview(label) {
                let _ = wv.eval(paint_js(rgb));
            }
        }
    }

    pub fn run(ctx: tauri::Context<tauri::Wry>) -> i32 {
        let out = PathBuf::from(std::env::var("MAUDE_SHELL_LANE_OUT").unwrap_or_else(|_| "shell-lane".into()));
        let _ = std::fs::create_dir_all(&out);
        let app = tauri::Builder::default()
            .on_window_event(|w, e| {
                if matches!(e, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
                    tabs::layout(w.app_handle());
                }
            })
            .setup(move |app| {
                let h = app.handle().clone();
                tabs::ensure_shell(&h)?;
                let tab = tabs::add_tab(&h, HOME_LABEL, |b| b)?;
                tabs::set_tab_shown(&tab, true);
                tabs::layout(&h);
                std::thread::spawn(move || drive(h, out));
                Ok(())
            })
            .build(ctx)
            .expect("shell_lane: could not build the app");
        let code = app.run_return(|_, _| {});
        // `drive` records its verdict before it asks the app to exit; 2 = it never got that far.
        code.max(VERDICT.load(Ordering::SeqCst))
    }

    static VERDICT: AtomicI32 = AtomicI32::new(2);

    fn drive(app: AppHandle, out: PathBuf) {
        std::thread::sleep(Duration::from_millis(1500));
        let mut failed = false;
        failed |= !check(&app, &out, "opened", false);
        if let Some(shell) = app.get_window(SHELL_LABEL) {
            let _ = shell.set_size(LogicalSize::new(1100.0, 720.0));
        }
        failed |= !check(&app, &out, "resized", false);
        tabs::set_overview(&app, true);
        failed |= !check(&app, &out, "overview", true);
        tabs::set_overview(&app, false);
        failed |= !check(&app, &out, "overview-closed", false);
        VERDICT.store(i32::from(failed), Ordering::SeqCst);
        app.exit(i32::from(failed));
    }

    /// Look until the state is right or 20 s pass; save the last picture; print the verdict.
    fn check(app: &AppHandle, out: &std::path::Path, name: &str, overview: bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut last = vec!["nothing was captured".to_string()];
        while Instant::now() < deadline {
            paint(app);
            std::thread::sleep(Duration::from_millis(500));
            let (tx, rx) = mpsc::channel();
            let a = app.clone();
            let file = out.join(format!("{name}.png"));
            let _ = app.run_on_main_thread(move || {
                let _ = tx.send(look(&a, &file, overview));
            });
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(problems)) => last = problems,
                Ok(Err(e)) => last = vec![e],
                Err(_) => last = vec!["the main thread did not answer".into()],
            }
            if last.is_empty() {
                break;
            }
        }
        if last.is_empty() {
            println!("shell_lane: {name}: ok");
            true
        } else {
            println!("shell_lane: {name}: FAILED\n  {}", last.join("\n  "));
            false
        }
    }

    fn area_of(w: &impl IsA<gtk::Widget>) -> Area {
        let a = w.allocation();
        (a.x(), a.y(), a.width(), a.height())
    }

    /// On the main thread: the allocations, a picture of the window (saved to `file`) and the verdict.
    fn look(app: &AppHandle, file: &std::path::Path, overview: bool) -> Result<Vec<String>, String> {
        let shell = app.get_window(SHELL_LABEL).ok_or("no shell window")?;
        let vbox = shell.default_vbox().map_err(|e| e.to_string())?;
        // The box's shown children in packing order: a menu bar if the app has one (not a webview — the
        // content box starts below it), then the strip, then the shown tab.
        let shown: Vec<gtk::Widget> = vbox.children().into_iter().filter(|c| c.is_visible()).collect();
        let is_webview = |c: &gtk::Widget| c.type_().name() == "WebKitWebView";
        let above: i32 = shown.iter().filter(|c| !is_webview(c)).map(|c| c.allocated_height()).sum();
        let views: Vec<&gtk::Widget> = shown.iter().filter(|c| is_webview(c)).collect();
        let strip = *views.first().ok_or("the strip is not shown")?;
        let tab = views.get(1).copied();
        let (vx, vy, vw, vh) = area_of(&vbox);
        let gtk_window = shell.gtk_window().map_err(|e| e.to_string())?;
        let gdk_window = gtk_window.window().ok_or("the window is not realized")?;
        let (w, h) = (gdk_window.width(), gdk_window.height());
        let pic = gdk_window.pixbuf(0, 0, w, h).ok_or("no picture of the window")?;
        let _ = pic.savev(file, "png", &[]);
        let bytes = pic.read_pixel_bytes();
        let (stride, n) = (pic.rowstride(), pic.n_channels());
        let (pw, ph) = (pic.width(), pic.height());
        let px = move |x: i32, y: i32| -> Option<(u8, u8, u8)> {
            if x < 0 || y < 0 || x >= pw || y >= ph {
                return None;
            }
            let i = (y * stride + x * n) as usize;
            Some((*bytes.get(i)?, *bytes.get(i + 1)?, *bytes.get(i + 2)?))
        };
        Ok(judge(&Seen {
            area: (vx, vy + above, vw, vh - above),
            strip: area_of(strip),
            tab: tab.map(|t| area_of(t)),
            overview,
            px: &px,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A window `h` tall whose strip is `strip_h` px and whose tab fills the rest.
    fn picture(strip_h: i32) -> impl Fn(i32, i32) -> Option<(u8, u8, u8)> {
        move |_x, y| Some(if y < strip_h { GREEN } else { MAGENTA })
    }

    #[test]
    fn a_strip_band_over_a_full_tab_passes() {
        let px = picture(STRIP_H as i32);
        let seen = Seen {
            area: (0, 0, 1280, 800),
            strip: (0, 0, 1280, 38),
            tab: Some((0, 38, 1280, 762)),
            overview: false,
            px: &px,
        };
        assert_eq!(judge(&seen), Vec::<String>::new());
    }

    /// #208 as the lane sees it: the strip took the top half of the window.
    #[test]
    fn the_half_split_window_fails() {
        let px = picture(400);
        let seen = Seen {
            area: (0, 0, 1280, 800),
            strip: (0, 0, 1280, 400),
            tab: Some((0, 400, 1280, 400)),
            overview: false,
            px: &px,
        };
        let problems = judge(&seen);
        assert!(problems.iter().any(|p| p.starts_with("the strip is at")), "{problems:?}");
        assert!(problems.iter().any(|p| p.starts_with("the tab a quarter down")), "{problems:?}");
        assert!(problems.iter().any(|p| p.starts_with("the tab is at")), "{problems:?}");
    }

    #[test]
    fn the_overview_strip_fills_the_window_and_hides_the_tab() {
        let px = picture(800);
        let ok = Seen { area: (0, 0, 1100, 720), strip: (0, 0, 1100, 720), tab: None, overview: true, px: &px };
        assert_eq!(judge(&ok), Vec::<String>::new());
        let px = picture(38);
        let stuck = Seen {
            area: (0, 0, 1100, 720),
            strip: (0, 0, 1100, 38),
            tab: Some((0, 38, 1100, 682)),
            overview: true,
            px: &px,
        };
        assert_eq!(judge(&stuck).len(), 4, "{:?}", judge(&stuck));
    }

    /// A black (unpainted) window is never a pass, and a missing pixel is a problem, not a panic.
    #[test]
    fn a_black_or_missing_picture_fails() {
        let black = |_x: i32, _y: i32| Some((0u8, 0u8, 0u8));
        let seen = Seen {
            area: (0, 0, 1280, 800),
            strip: (0, 0, 1280, 38),
            tab: Some((0, 38, 1280, 762)),
            overview: false,
            px: &black,
        };
        assert_eq!(judge(&seen).len(), 4);
        let none = |_x: i32, _y: i32| None;
        assert_eq!(judge(&Seen { px: &none, ..seen }).len(), 4);
    }

    /// The paint script is plain JS: balanced braces, the colour in it, and a guard so repeats do not stack.
    #[test]
    fn the_paint_script_is_well_formed() {
        let js = paint_js(GREEN);
        assert!(js.contains("rgb(0,255,0)") && js.starts_with("if(!window.__shellLane)"), "{js}");
        assert_eq!(js.matches('{').count(), js.matches('}').count(), "{js}");
        assert_eq!(js.matches('(').count(), js.matches(')').count(), "{js}");
    }
}
