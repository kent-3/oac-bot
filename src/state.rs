use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs, io,
    path::Path,
    time::{Duration, Instant},
};

use teloxide::types::UserId;

pub fn save_oac_members_to_file(oac_members: &HashSet<UserId>, file_path: &Path) -> io::Result<()> {
    let serialized =
        serde_json::ser::to_string(oac_members).expect("Failed to serialize oac_members");
    fs::write(file_path, serialized)
}

pub fn load_oac_members_from_file(file_path: &Path) -> io::Result<HashSet<UserId>> {
    let file_contents = fs::read(file_path)?;
    let deserialized: HashSet<UserId> =
        serde_json::de::from_slice(&file_contents).expect("Failed to deserialize oac_members");
    Ok(deserialized)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TokenPrice {
    pub id: String,
    pub name: String,
    pub value: String,
    pub price_24hr_change: String,
}

#[derive(Debug)]
pub struct Cache {
    pub last_fetch_time: Instant,
    pub data: Vec<TokenPrice>,
}

impl Cache {
    const SHADE_API: &'static str =
        "https://na36v10ce3.execute-api.us-east-1.amazonaws.com/API-mainnet-STAGE/token_prices";

    pub fn new() -> Self {
        Cache {
            data: Vec::<TokenPrice>::new(),
            // set to a past time to trigger initial fetch
            last_fetch_time: Instant::now() - Duration::from_secs(5 * 60 + 1),
        }
    }

    pub fn needs_update(&self) -> bool {
        self.last_fetch_time.elapsed() > Duration::from_secs(5 * 60)
    }

    pub async fn fetch_and_cache_data(&mut self) -> Result<Vec<TokenPrice>, reqwest::Error> {
        let now = Instant::now();
        let time_diff = now.duration_since(self.last_fetch_time).as_secs();

        if time_diff > 5 * 60 || self.data.is_empty() {
            log::debug!("Fetching and caching data...");

            let response = reqwest::get(Self::SHADE_API).await?;

            if response.status().is_success() {
                let mut data = response.json::<Vec<TokenPrice>>().await?;
                process_data(&mut data);
                self.data = data;
                self.last_fetch_time = now;
            } else {
                log::error!("HTTP error! status: {}", response.status());
            }
        }

        Ok(self.data.clone())
    }

    pub fn search(&self, name: &str) -> Vec<&TokenPrice> {
        let name = name.to_lowercase();

        self.data
            .iter()
            .filter(|&item| {
                item.name.to_lowercase().contains(name.trim()) && !item.name.ends_with("LP")
            })
            .collect()
    }
}

fn process_data(data: &mut [TokenPrice]) {
    data.sort_unstable_by(|a, b| a.name.cmp(&b.name))
}
