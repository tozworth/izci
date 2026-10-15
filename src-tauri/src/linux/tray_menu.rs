use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle,
};

#[derive(Clone, Debug, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub disabled: bool,
    pub checked: Option<bool>,
    #[serde(default)]
    pub separator_before: bool,
    #[serde(default)]
    pub children: Vec<Item>,
}

// Build the replacement before touching the indicator's existing menu. Linux
// indicators retain their original root menu, so only its contents may change.
pub fn build(app: &AppHandle, items: &[Item]) -> tauri::Result<Vec<MenuItemKind<tauri::Wry>>> {
    let mut result = Vec::new();
    for item in items {
        if item.separator_before {
            result.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(
                app,
            )?));
        }
        // Labels come from translations and user-named Raf presets, not mnemonics.
        let label = item.label.replace('&', "&&");
        result.push(if !item.children.is_empty() {
            let submenu = Submenu::with_id(app, &item.id, label, !item.disabled)?;
            for child in build(app, &item.children)? {
                submenu.append(&child)?;
            }
            MenuItemKind::Submenu(submenu)
        } else if let Some(checked) = item.checked {
            MenuItemKind::Check(CheckMenuItem::with_id(
                app,
                &item.id,
                label,
                !item.disabled,
                checked,
                None::<&str>,
            )?)
        } else {
            MenuItemKind::MenuItem(MenuItem::with_id(
                app,
                &item.id,
                label,
                !item.disabled,
                None::<&str>,
            )?)
        });
    }
    Ok(result)
}

pub fn replace(menu: &Menu<tauri::Wry>, items: &[MenuItemKind<tauri::Wry>]) -> tauri::Result<()> {
    for old in menu.items()? {
        menu.remove(&old)?;
    }
    for item in items {
        menu.append(item)?;
    }
    Ok(())
}

pub fn enabled_action(items: &[Item], id: &str) -> bool {
    items.iter().any(|item| {
        !item.disabled
            && if item.children.is_empty() {
                item.id == id
            } else {
                enabled_action(&item.children, id)
            }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_contract_preserves_checks_and_rejects_disabled_actions() {
        let items: Vec<Item> = serde_json::from_value(serde_json::json!([
            {"id":"togglePlayback", "label":"Play", "disabled":true},
            {"id":"raf", "label":"Raf", "separatorBefore":true, "children":[
                {"id":"applyRafPreset:one", "label":"One", "checked":true}
            ]},
            {"id":"exit", "label":"Exit"}
        ]))
        .unwrap();
        assert!(!enabled_action(&items, "togglePlayback"));
        assert!(enabled_action(&items, "applyRafPreset:one"));
        assert!(enabled_action(&items, "exit"));
        assert!(!enabled_action(&items, "raf"));
        assert!(!enabled_action(&items, "unknown"));
        assert_eq!(items[1].children[0].checked, Some(true));
        assert!(items[1].separator_before);
        let mut disabled = items;
        disabled[1].disabled = true;
        assert!(!enabled_action(&disabled, "applyRafPreset:one"));
    }
}
