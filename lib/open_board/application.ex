defmodule OpenBoard.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      OpenBoardWeb.Telemetry,
      OpenBoard.Repo,
      {DNSCluster, query: Application.get_env(:open_board, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: OpenBoard.PubSub},
      OpenBoardWeb.Presence,
      {Finch, name: OpenBoard.Finch},
      OpenBoardWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: OpenBoard.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    OpenBoardWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
