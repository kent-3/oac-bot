import { createCanvas, registerFont } from 'canvas';
import { Chart, ChartItem, registerables } from 'chart.js'
import fs from "fs";
Chart.register(...registerables);
Chart.defaults.color = "white";
Chart.defaults.font.weight = "500";
// Chart.defaults.font.size = 14;

const plugin = {
  id: "customCanvasBackgroundColor",
  //@ts-ignore
  beforeDraw: (chart, args, options) => {
    const { ctx } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = options.color || "#ffffff";
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  },
};

export async function createChart(filePath: string) {

  // Set up the virtual canvas
  const width = 800; // Width of the canvas
  const height = 400; // Height of the canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as ChartItem;

  interface BalancesData {
    completion_time: string;
    balance: string;
  }

  interface GroupedData {
    date: string;
    balance: number;
  }

  // Fetch the JSON file
  // const filePath = "unbonding.json";
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const balancesData = JSON.parse(fileContent);

  const groupedData: GroupedData[] = Object.values(balancesData).flatMap(
    (entries: unknown) =>
      (entries as BalancesData[]).map(({ completion_time, balance }) => ({
        date: new Date(completion_time).toLocaleDateString(),
        balance: parseInt(balance) / 1000000,
      }))
  );

  // Group balances by date
  const groupedByDate: Record<string, number[]> = groupedData.reduce(
    (groups: Record<string, number[]>, { date, balance }) => {
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(balance);
      return groups;
    },
    {}
  );

  // Sort the grouped data by date
  const sortedData: [string, number[]][] = Object.entries(groupedByDate).sort(
    ([dateA], [dateB]) => {
      const date1 = new Date(dateA).getTime();
      const date2 = new Date(dateB).getTime();
      return date1 - date2;
    }
  );

  // Extract the dates and balances
  const labels: string[] = sortedData.map(([date]) => {
    const dateObj = new Date(date);
    const day = dateObj.getDate().toString().padStart(2, "0");
    const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
    return `${month}/${day}`;
  });

  const datasets = [
    {
      label: "SCRT",
      data: sortedData.map(([_, balances]) =>
        balances.reduce((sum, balance) => sum + balance, 0)
      ),
      backgroundColor: "rgba(0, 123, 255, 0.5)",
      borderColor: "rgba(0, 123, 255, 1)",
      borderWidth: 1,
    },
  ];

  const totalUnbonding = datasets[0].data.reduce(
    (sum, balance) => sum + balance,
    0
  );

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: datasets,
    },
    options: {
      layout: {
        padding: {
          top: 5,
          bottom: 20,
          left: 20,
          right: 20,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: {
              size: 16,
            },
          },
          grid: {
            color: "#1f1f1f",
          },
        },
        x: {
          grid: {
            color: "#1f1f1f",
          },
        },
      },
      plugins: {
        //@ts-ignore
        customCanvasBackgroundColor: {
          color: "#2d2e2f",
        },
        legend: {
          display: false,
        },
        title: {
          display: true,
          text: "SCRT Unbonding",
          font: {
            size: 24,
          },
          padding: {
            top: 10,
            bottom: 0,
          },
        },
        subtitle: {
          display: true,
          text: `Total: ${Math.round(totalUnbonding).toLocaleString()} SCRT`,
          font: {
            size: 16,
          },
          padding: {
            bottom: 10,
          },
        },
      },
    },
    plugins: [plugin],
  });

	return canvas.toBuffer('image/png')
  // const imageBuffer = canvas.toBuffer('image/png');
  // fs.writeFileSync('chart.png', imageBuffer);

  // Render the chart to an image file
  // const outputFile = "chart.png"; // Output file path
  // const stream = canvas.createPNGStream();
  // const out = fs.createWriteStream(outputFile);
  // stream.pipe(out);
  // out.on("finish", () => console.log(`Chart saved as ${outputFile}`));
}