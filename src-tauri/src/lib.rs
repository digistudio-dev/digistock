//! DigiStock — application de bureau par DigiStudio.

mod audit;
mod backup;
mod commands;
mod db;
mod domain;
mod error;
mod notify;
mod premium;
mod premium_codes;
#[cfg(debug_assertions)]
mod seed;
mod state;
mod whatsapp;

use state::AppState;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_log::{Target, TargetKind};

pub fn run() {
    let log_level = if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([Target::new(TargetKind::LogDir { file_name: Some("digistock".into()) }), Target::new(TargetKind::Stdout)])
                .level(log_level)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("digistock.db");
            log::info!("DigiStock {} — base : {}", app.package_info().version, db_path.display());
            let mut conn = db::open(&db_path).map_err(|e| e.to_string())?;
            db::migrate(&mut conn).map_err(|e| e.to_string())?;
            let _ = notify::scan_expirations(&conn);
            app.manage(AppState::new(conn, db_path, data_dir));
            app.manage(whatsapp::WhatsApp::default());

            // Sauvegardes automatiques (Premium) : vérification périodique en arrière-plan.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(90));
                let state = handle.state::<AppState>();
                match backup::auto_tick(&state) {
                    Ok(Some(info)) => {
                        let _ = handle.emit("backup://done", info);
                    }
                    Ok(None) => {}
                    Err(e) => log::error!("Sauvegarde automatique impossible : {e}"),
                }
                std::thread::sleep(Duration::from_secs(15 * 60 - 90));
            });

            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_bootstrap,
            commands::setup_complete,
            commands::dev_seed_demo,
            commands::auth_login,
            commands::auth_logout,
            commands::auth_unlock,
            commands::auth_change_password,
            commands::users_save,
            commands::roles_save,
            commands::db_select,
            commands::entity_save,
            commands::entity_archive,
            commands::company_save,
            commands::settings_set,
            commands::product_save,
            commands::product_duplicate,
            commands::stock_adjust,
            commands::stock_transfer,
            commands::inventory_start,
            commands::inventory_set_count,
            commands::inventory_remove_item,
            commands::inventory_validate,
            commands::inventory_cancel,
            commands::sale_create,
            commands::sale_cancel,
            commands::purchase_save,
            commands::purchase_receive,
            commands::purchase_cancel,
            commands::supplier_payment,
            commands::customer_payment,
            commands::premium_activate,
            commands::premium_deactivate,
            commands::backup_create,
            commands::backup_list,
            commands::backup_restore,
            commands::file_save,
            commands::image_store,
            commands::logs_export,
            commands::notifications_scan,
            commands::notifications_mark_read,
            commands::wa_start,
            commands::wa_status,
            commands::wa_send,
            commands::wa_logout,
            commands::wa_log_link,
            commands::document_export,
            commands::wa_stop,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de DigiStock")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<whatsapp::WhatsApp>().stop();
            }
        });
}
