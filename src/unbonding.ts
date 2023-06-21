import { SecretNetworkClient } from "secretjs";
import { UnbondingDelegationEntry } from "secretjs/dist/grpc_gateway/cosmos/staking/v1beta1/staking.pb";
import fs from "fs";

export async function getTotalUnbonding() {
  const startTime = performance.now();

  const client = new SecretNetworkClient({
    url: "https://lcd.secret.express",
    chainId: "secret-4",
  });
  console.log(`Initialized read-only client.`);

  const response = await client.query.staking.validators({
    // status: "BOND_STATUS_BONDED",
    pagination: {
      limit: "300",
    },
  });
  const validators = response.validators!;
  console.log(`Total Validators: ${validators.length}`);

  const operatorAddresses: string[] = [];
  const validator_names: string[] = [];
  const unbondingResponsesByValidator = new Map<
    string,
    UnbondingDelegationEntry[]
  >();
  let totalUnbonding = 0;

  try {
    for (let i = 0; i < validators.length; i++) {
      const validatorName = validators[i].description?.moniker!;
      validator_names.push(validatorName);

      const validator_address = validators[i].operator_address!;
      operatorAddresses.push(validator_address);

      const unbondings =
        await client.query.staking.validatorUnbondingDelegations({
          validator_addr: validator_address,
          pagination: { limit: "10000" },
        });

      if (unbondings.unbonding_responses?.length! > 0) {
        const entriesArray = unbondings.unbonding_responses!.flatMap(
          (response) => {
            return response.entries!.map(({ completion_time, balance }) => ({
              completion_time,
              balance,
            }));
          }
        );
        unbondingResponsesByValidator.set(validatorName, entriesArray);
      }
    }

    for (const [
      validatorName,
      unbondingResponses,
    ] of unbondingResponsesByValidator.entries()) {
      const balance = unbondingResponses.reduce(
        (sum: number, entry: UnbondingDelegationEntry) => {
          const entryBalance = parseInt(entry.balance!);
          return sum + entryBalance;
        },
        0
      );

      totalUnbonding += balance;

      console.log();
      console.log(
        validatorName,
        Math.floor(balance / 1000000).toLocaleString()
      );
      console.log("Unbonding Responses:", unbondingResponses.length);
    }

    console.log(
      "\nTotal:",
      Math.floor(totalUnbonding / 1000000).toLocaleString(),
      "SCRT"
    );
    console.log("Validators: ", operatorAddresses.length);
  } catch (error) {
    throw new Error(`Error:\n ${JSON.stringify(error, null, 4)}`);
  }

  // Convert the map to a plain object
  const unbondingResponsesObject = Object.fromEntries(
    unbondingResponsesByValidator
  );

  // Convert the object to a JSON string
  const jsonData = JSON.stringify(unbondingResponsesObject, null, 2);

  // Save the JSON string to a file
  fs.writeFileSync("unbonding.json", jsonData, "utf8");

  const endTime = performance.now();
  const totalTime = (endTime - startTime) / 1000;
  console.log("\nTotal time:", totalTime, "seconds");
}