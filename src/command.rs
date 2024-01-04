use crate::state::save_oac_members_to_file;

use std::{collections::HashSet, env, sync::Arc};
use tokio::sync::RwLock;

use teloxide::{prelude::*, utils::command::BotCommands};

type HandlerResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

#[derive(BotCommands, Clone)]
#[command(rename_rule = "lowercase", description = "Check out these commands!")]
pub enum Command {
    #[command(description = "Be greeted by the bot")]
    Start,
    #[command(description = "Get a list of commands")]
    Help,
}

pub async fn start(
    bot: Bot,
    oac_members: Arc<RwLock<HashSet<UserId>>>,
    msg: Message,
) -> HandlerResult {
    log::debug!("handling /start command");

    let mut oac_members = oac_members.write().await;

    if let Some(user) = msg.from() {
        oac_members.insert(user.id);

        bot.send_message(msg.chat.id, "https://t.me/AmberDAOscrt")
            .await?;

        let file_path = env::current_dir()?.join("members.json");
        // TODO - this has to be very inefficient to do every single time
        save_oac_members_to_file(&oac_members, &file_path)?;

        log::debug!("added {:#?} to oac_members", user.id);
    }

    Ok(())
}

pub async fn help(bot: Bot, msg: Message) -> HandlerResult {
    log::debug!("handling /help command");

    bot.send_message(msg.chat.id, Command::descriptions().to_string())
        .await?;

    Ok(())
}
