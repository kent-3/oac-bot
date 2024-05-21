mod command;
mod state;

use crate::command::*;
use crate::state::*;

use color_eyre::eyre::{OptionExt, Result};
use std::{collections::HashSet, env, sync::Arc};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use teloxide::{
    dispatching::{UpdateFilterExt, UpdateHandler},
    prelude::*,
    types::{
        InlineQueryResult, InlineQueryResultArticle, InputMessageContent, InputMessageContentText,
    },
    utils::command::BotCommands,
    Bot, RequestError,
};
use tracing::{debug, error, info, warn};

type HandlerResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

#[tokio::main]
async fn main() -> Result<()> {
    color_eyre::install()?;
    pretty_env_logger::init();
    info!("Starting bot...");

    let file_path = env::current_dir()?.join("members.json");
    let oac_members: HashSet<UserId> = load_oac_members_from_file(&file_path).unwrap_or_default();
    debug!("OAC members: {:#?}", &oac_members);

    let cache = Arc::new(Mutex::new(Cache::new()));
    let oac_members = Arc::new(RwLock::new(oac_members));

    let bot = Bot::from_env();
    bot.set_my_commands(Command::bot_commands()).await?;

    Dispatcher::builder(bot, schema())
        .dependencies(dptree::deps![cache, oac_members])
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;

    Ok(())
}

fn schema() -> UpdateHandler<Box<dyn std::error::Error + Send + Sync + 'static>> {
    use dptree::case;

    let command_handler = teloxide::filter_command::<Command, _>()
        .branch(case![Command::Start].endpoint(start))
        .branch(case![Command::Help].endpoint(help));

    let message_handler = Update::filter_message()
        .branch(command_handler) // Commands are a subset of messages
        .branch(dptree::endpoint(handle_message)); // General message handler

    let inline_query_handler =
        Update::filter_inline_query().branch(dptree::endpoint(handle_inline_query));

    dptree::entry()
        .branch(message_handler)
        .branch(inline_query_handler)
}

async fn handle_message(bot: Bot, msg: Message) -> HandlerResult {
    debug!("handling message");

    if let Some(user) = msg.from() {
        info!("Received message from user ID: {}", user.id);
        bot.send_message(msg.chat.id, "I heard that").await?;
    }

    Ok(())
}

async fn handle_inline_query(
    bot: Bot,
    cache: Arc<Mutex<Cache>>,
    oac_members: Arc<RwLock<HashSet<UserId>>>,
    q: InlineQuery,
) -> HandlerResult {
    let query = q.query.trim();

    if query.is_empty() {
        debug!("Empty query");
        bot.answer_inline_query(&q.id, vec![]).send().await?;
        return Ok(());
    }

    let oac_members = oac_members.read().await;

    if !oac_members.contains(&q.from.id) {
        let article = InlineQueryResult::Article(
            InlineQueryResultArticle::new(
                "001",
                "👆👆👆",
                // TODO - Decide what should be sent if a user selects this article
                InputMessageContent::Text(InputMessageContentText::new("@two_amber_bot")),
            )
            .description("Follow the link above to use this bot")
            .thumb_url(reqwest::Url::parse(
                "https://raw.githubusercontent.com/kent-3/amber-app/main/static/amber-logo.png",
            )?),
        );

        let response = bot
            .answer_inline_query(&q.id, vec![article])
            .switch_pm_text("Support Amber on Telegram")
            .switch_pm_parameter("amber_rocks")
            .cache_time(10)
            .send()
            .await;
        if let Err(err) = response {
            error!("Error in handler: {:?}", err);
        };
        return Ok(());
    }

    let mut cache = cache.lock().await;

    if cache.tokens_need_update() {
        cache.fetch_and_cache_tokens().await?;
    }
    if cache.prices_need_update() {
        cache.fetch_and_cache_prices().await?;
    }

    let results: Vec<InlineQueryResult> = match query {
        "ratio" => {
            let (shd_scrt, shd_stkd_scrt) = calculate_ratios(&cache.data)
                .map_err(|err| RequestError::from(std::io::Error::other(err.to_string())))?;

            let article1 = ratio2article("SHD", "SCRT", shd_scrt);
            let article2 = ratio2article("SHD", "stkd-SCRT", shd_stkd_scrt);

            vec![article1, article2]
        }
        _ => cache.search(query).into_iter().map(asset2article).collect(),
    };

    let response = bot
        .answer_inline_query(&q.id, results)
        .switch_pm_text("Powered by Amber")
        .switch_pm_parameter("parameter")
        .send()
        .await;

    if let Err(err) = response {
        error!("Error in inline query handler: {:?}", err);
    };

    Ok(())
}

fn asset2article(asset: &Token) -> InlineQueryResult {
    let price = asset
        .price_token
        .iter()
        .next()
        .and_then(|pt| pt.value)
        .map_or_else(
            || "Price token or value is missing".to_string(),
            |value| format!("{} = {:.3} USD", asset.symbol, value),
        );

    // let price_24hr_change = asset.price_24hr_change.parse::<f64>().unwrap_or_default();

    InlineQueryResult::Article(
        InlineQueryResultArticle::new(
            &asset.id,
            &price,
            InputMessageContent::Text(InputMessageContentText::new(&price)),
        )
        // .description(format!("24h    {:+.3}%", price_24hr_change))
        .description(&asset.description), // .thumb_url(
                                          // "https://raw.githubusercontent.com/cosmos/chain-registry/master/secretnetwork/images/shd.png"
                                          // asset
                                          //     .logo_path
                                          //     .as_deref()
                                          //     .unwrap_or_default()
                                          // .parse()
                                          // .unwrap(),
                                          // )
                                          // .url("https://app.shadeprotocol.io/swap".parse().unwrap()),
    )
}

fn ratio2article(token1: &str, token2: &str, ratio: f64) -> InlineQueryResult {
    let text = format!("1 {} = {:.2} {}", token1, ratio, token2);
    InlineQueryResult::Article(InlineQueryResultArticle::new(
        Uuid::new_v4(),
        &text,
        InputMessageContent::Text(InputMessageContentText::new(&text)),
    )
        .thumb_url(
            "https://raw.githubusercontent.com/cosmos/chain-registry/master/secretnetwork/images/shd.png"
                .parse()
                .unwrap(),
            )
    )
}

fn calculate_ratios(data: &[Token]) -> Result<(f64, f64)> {
    let mut shd = None;
    let mut scrt = None;
    let mut stkd_scrt = None;

    for token in data {
        match token.symbol.as_str() {
            "SHD" => {
                shd = token.price_token.iter().next().and_then(|pt| pt.value);
            }
            "SCRT" => {
                scrt = token.price_token.iter().next().and_then(|pt| pt.value);
            }
            "stkd-SCRT" => {
                stkd_scrt = token.price_token.iter().next().and_then(|pt| pt.value);
            }
            _ => {}
        }
    }

    let shd = shd.ok_or_eyre("SHD not found")?;
    let scrt = scrt.ok_or_eyre("SCRT not found")?;
    let stkd_scrt = stkd_scrt.ok_or_eyre("stkd-SCRT not found")?;

    // let shd_value = shd.parse::<f64>()?;
    // let scrt_value = scrt.parse::<f64>()?;
    // let stkd_scrt_value = stkd_scrt.parse::<f64>()?;

    let ratio1 = shd / scrt;
    let ratio2 = shd / stkd_scrt;

    Ok((ratio1, ratio2))
}
